// A small Server-Sent Events reader for fetch() bodies (EventSource can't POST).

/** Feeds text chunks, calls onEvent({ event, data }) for each complete event (data JSON-parsed when it can be). */
export function createSseParser(onEvent) {
  let buf = '';
  const flush = (block) => {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) return;
    const raw = data.join('\n');
    let parsed = raw;
    try { parsed = JSON.parse(raw); } catch { /* left as text */ }
    onEvent({ event, data: parsed });
  };
  return {
    push(chunk) {
      buf += String(chunk).replace(/\r\n?/g, '\n');
      let at;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        flush(block);
      }
    },
    end() { if (buf.trim()) flush(buf); buf = ''; },
  };
}

/** Reads a ReadableStream<Uint8Array> of SSE, calling onEvent for each event. */
export async function readSse(body, onEvent) {
  const parser = createSseParser(onEvent);
  const reader = body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(dec.decode(value, { stream: true }));
  }
  parser.push(dec.decode());
  parser.end();
}
