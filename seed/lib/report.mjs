// Runner de pasos con tabla ✓/✗ final. Un paso lanza una excepción para fallar; devuelve un texto de detalle opcional.
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export function createReport(title) {
  const rows = [];
  async function step(name, fn, { skip } = {}) {
    if (skip) { rows.push({ name, status: 'skip', detail: skip, ms: 0 }); console.log(`  ${c(33, '↷')} ${name} — ${skip}`); return undefined; }
    const t0 = Date.now();
    try {
      const out = await fn();
      const detail = typeof out === 'string' && !/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(out) ? out : '';
      rows.push({ name, status: 'ok', detail, ms: Date.now() - t0 });
      console.log(`  ${c(32, '✓')} ${name}${detail ? c(2, ` — ${detail}`) : ''}`);
      return out;
    } catch (e) {
      rows.push({ name, status: 'fail', detail: e?.message ?? String(e), ms: Date.now() - t0 });
      console.log(`  ${c(31, '✗')} ${name} — ${e?.message ?? e}`);
      return undefined;
    }
  }
  function finish() {
    const ok = rows.filter((r) => r.status === 'ok').length;
    const fail = rows.filter((r) => r.status === 'fail').length;
    const skip = rows.filter((r) => r.status === 'skip').length;
    const w = Math.max(...rows.map((r) => r.name.length), 10);
    console.log(`\n${title}`);
    console.log('─'.repeat(w + 22));
    for (const r of rows) {
      const mark = r.status === 'ok' ? c(32, '✓') : r.status === 'fail' ? c(31, '✗') : c(33, '↷');
      console.log(`${mark} ${r.name.padEnd(w)}  ${String(r.ms).padStart(5)} ms`);
    }
    console.log('─'.repeat(w + 22));
    console.log(`${ok} ✓   ${fail} ✗   ${skip} ↷`);
    return fail === 0 ? 0 : 1;
  }
  return { step, finish, rows };
}
