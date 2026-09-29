from pathlib import Path
p=Path('tests/integration/agent-review.test.mjs')
s=p.read_text(encoding='utf-8')
s=s.replace('  t.after(() => rm(root, { recursive: true, force: true }));\n','')
s=s.replace('  t.after(() => app.close());','  t.after(async () => { await app.close(); await rm(root, {recursive:true,force:true}); });')
s=s.replace('  t.after(() => db.close());','  t.after(async () => { db.close(); await rm(root, {recursive:true,force:true}); });')
p.write_text(s,encoding='utf-8')
