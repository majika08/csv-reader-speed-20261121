// Fast exact drop-in for csv-reader 1.0.0.
// Strategy: indexOf-driven fast paths for clean spans, with a per-record CR
// classification that lets ~98% of lines skip per-field CR logic entirely,
// and an exact per-character slow path only for fields that contain a lone
// CR or other broken constructs. Semantics replicate csv-reader 1.0.0
// exactly: BOM dropped; record ends at LF or CRLF; empty line = no record;
// lone CR outside quotes dropped (stray_cr); quoted field runs to the next
// non-doubled quote, "" = one quote, CRLF/lone CR inside quotes read as LF;
// junk after a closing quote appended as-is (quote_junk when the field
// ends); unclosed quote = literal, text after re-read as unquoted
// (unterminated_quote); quote inside an unquoted field is literal; fields
// never trimmed; columns = first record if header else null; rows padded
// (short_row) or cut (long_row) to the first record's width; errors
// {code, line, row} in the order met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// Per-record CR classes: NOCR = no CR before the record's next LF,
// CRLF = the only CR before it is the CR of the closing CRLF,
// GENERAL = anything else (stray CRs, CRs inside quotes).
const M_NOCR = 0;
const M_CRLF = 1;
const M_GENERAL = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const N = text.length;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Cached position of the next CR at or after the last lookup (-2: unknown).
  let nextCR = -2;
  // Cached index of the next LF at or after the position it was computed
  // from (N when none). Invariant: it is always the first LF >= its origin,
  // so it stays valid for any later `from` it is not behind.
  let lineEndCache = -1;

  // Per-record CR mode, valid while pos <= modeUntil (the record's line end).
  let lineMode = M_GENERAL;
  let modeUntil = -1;

  // Shared field-read results (avoid per-field object allocation).
  let fEnded = END;
  let fAdded = 0;

  function findNextCR(from) {
    if (nextCR < from) {
      nextCR = text.indexOf('\r', from);
      if (nextCR === -1) nextCR = Infinity;
    }
    return nextCR;
  }

  function curLineEnd(from) {
    if (lineEndCache < from) {
      lineEndCache = text.indexOf('\n', from);
      if (lineEndCache === -1) lineEndCache = N;
    }
    return lineEndCache;
  }

  // Classify the CR situation of the physical line starting at `from`:
  // NOCR when no CR precedes its LF, CRLF when the only CR before its LF
  // is the CR of the closing CRLF, GENERAL otherwise. The first CR at or
  // after `from` decides: if it is at line-end-1 there can be no other CR
  // before the LF.
  function computeMode(from) {
    const le = curLineEnd(from);
    const r = findNextCR(from);
    if (r >= le) lineMode = M_NOCR;
    else if (le < N && r === le - 1) lineMode = M_CRLF;
    else lineMode = M_GENERAL;
    modeUntil = le;
  }

  // Exact per-character unquoted read (reference semantics), starting with
  // `initial` already in the value. Sets fEnded/fAdded; returns the value.
  function readUnquotedSlow(initial) {
    const parts = initial ? [initial] : [];
    let added = 0;
    let seg = pos;
    while (pos < N) {
      const cc = text.charCodeAt(pos);
      if (cc === 44) {
        parts.push(text.slice(seg, pos));
        pos += 1;
        fEnded = COMMA;
        fAdded = added;
        return parts.join('');
      }
      if (cc === 10) {
        parts.push(text.slice(seg, pos));
        pos += 1;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = added;
        return parts.join('');
      }
      if (cc === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          parts.push(text.slice(seg, pos));
          pos += 2;
          line += 1;
          fEnded = LINE_BREAK;
          fAdded = added;
          return parts.join('');
        }
        parts.push(text.slice(seg, pos));
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        seg = pos;
        continue;
      }
      added += 1;
      pos += 1;
    }
    parts.push(text.slice(seg, pos));
    fEnded = END;
    fAdded = added;
    return parts.join('');
  }

  // Unquoted read: fast path when the field span holds no CR except possibly
  // the CR of a closing CRLF; slow path otherwise.
  function readUnquoted(initial) {
    const cEnd = text.indexOf(',', pos);
    const lEnd = curLineEnd(pos);
    const e = Math.min(cEnd === -1 ? N : cEnd, lEnd);
    const r = findNextCR(pos);
    if (r < e) {
      // A CR inside the span: only the CRLF-terminator case stays fast.
      if (r === e - 1 && lEnd === e && e < N) {
        const v = initial + text.slice(pos, e - 1);
        fAdded = e - 1 - pos;
        pos = e + 1;
        line += 1;
        fEnded = LINE_BREAK;
        return v;
      }
      return readUnquotedSlow(initial);
    }
    const v = initial + text.slice(pos, e);
    fAdded = e - pos;
    if (e >= N) {
      pos = N;
      fEnded = END;
    } else if (cEnd === e) {
      pos = e + 1;
      fEnded = COMMA;
    } else {
      pos = e + 1;
      line += 1;
      fEnded = LINE_BREAK;
    }
    return v;
  }

  // What follows a closing quote at quotePos (pos is just past it).
  function afterClose(value) {
    if (pos >= N) {
      fEnded = END;
      return value;
    }
    const cc = text.charCodeAt(pos);
    if (cc === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (cc === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    const v = readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return v;
  }

  // General quoted read: escapes and/or CR/LF inside. open is the quote index.
  function readQuotedGeneral(open) {
    const parts = [];
    let seg = open + 1;
    let i = open + 1;
    let close = -1;
    for (;;) {
      const q = text.indexOf('"', i);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        parts.push(text.slice(seg, q), '"');
        i = q + 2;
        seg = q + 2;
        continue;
      }
      parts.push(text.slice(seg, q));
      close = q;
      break;
    }
    if (close === -1) {
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      return readUnquoted('"');
    }
    let value = parts.join('');
    if (value.indexOf('\r') !== -1) {
      const breaks = value.match(/\r\n|\r|\n/g);
      line += breaks ? breaks.length : 0;
      value = value.replace(/\r\n|\r/g, '\n');
    } else if (value.indexOf('\n') !== -1) {
      let cnt = 0;
      let k = value.indexOf('\n');
      while (k !== -1) {
        cnt += 1;
        k = value.indexOf('\n', k + 1);
      }
      line += cnt;
    }
    pos = close + 1;
    return afterClose(value);
  }

  // Quoted read with fast path: single slice when the span up to the closing
  // quote holds no escape, no CR and no LF.
  function readQuoted() {
    const open = pos;
    const q = text.indexOf('"', open + 1);
    if (q === -1) {
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      return readUnquoted('"');
    }
    if (text.charCodeAt(q + 1) !== 34) {
      const r = findNextCR(open + 1);
      const le = curLineEnd(open + 1);
      if ((r === Infinity || r >= q) && le >= q) {
        const value = text.slice(open + 1, q);
        pos = q + 1;
        return afterClose(value);
      }
    }
    return readQuotedGeneral(open);
  }

  // Width/header handling shared by both record paths. Returns true when the
  // fields formed a record (false for the stray-CR-only no-record line).
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return false;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return true;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < N) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Quote-free-line split: the whole physical line has no quote and no CR
    // except possibly the CR of its closing CRLF.
    const le = curLineEnd(pos);
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= le) {
      const r = findNextCR(pos);
      const hasCRLF = le < N && r === le - 1;
      if (r >= le || hasCRLF) {
        const end = hasCRLF ? le - 1 : le;
        const fields = [];
        let s = pos;
        for (;;) {
          const c = text.indexOf(',', s);
          if (c === -1 || c >= end) {
            fields.push(text.slice(s, end));
            break;
          }
          fields.push(text.slice(s, c));
          s = c + 1;
        }
        pos = le < N ? le + 1 : N;
        if (le < N) line += 1;
        finishRecord(fields, false);
        continue;
      }
    }

    computeMode(pos);
    const fields = [];
    let quoted = false;
    let value;
    do {
      // A quoted field may have consumed an embedded newline, moving pos
      // past the line the mode was computed for; reclassify then.
      if (pos > modeUntil) computeMode(pos);
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        value = readQuoted();
      } else if (lineMode === M_GENERAL) {
        quoted = false;
        value = readUnquoted('');
      } else {
        // Inlined unquoted fast path: the line mode proves the span up to
        // the next comma or LF holds no CR (NOCR), or only the CRLF's CR
        // at its very end (CRLF).
        quoted = false;
        const cEnd = text.indexOf(',', pos);
        const e = cEnd === -1 || cEnd > modeUntil ? modeUntil : cEnd;
        if (lineMode === M_NOCR) {
          value = text.slice(pos, e);
          fAdded = e - pos;
          if (e >= N) {
            pos = N;
            fEnded = END;
          } else if (cEnd === e) {
            pos = e + 1;
            fEnded = COMMA;
          } else {
            pos = e + 1;
            line += 1;
            fEnded = LINE_BREAK;
          }
        } else {
          // CRLF: a comma ends before the CR; an LF end drops the CR.
          if (cEnd === e) {
            value = text.slice(pos, e);
            fAdded = e - pos;
            pos = e + 1;
            fEnded = COMMA;
          } else {
            value = text.slice(pos, e - 1);
            fAdded = e - 1 - pos;
            pos = e + 1;
            line += 1;
            fEnded = LINE_BREAK;
          }
        }
      }
      fields.push(value);
    } while (fEnded === COMMA);
    finishRecord(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
