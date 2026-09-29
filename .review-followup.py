from pathlib import Path

def replace(path, old, new):
    p=Path(path); text=p.read_text(encoding='utf-8')
    if old not in text: raise RuntimeError('Expected source not found: '+path)
    p.write_text(text.replace(old,new),encoding='utf-8')

replace('apps/server/src/http/agent-api.ts','      !latest ||\n      latest.role !== "user" ||','      latest?.role !== "user" ||')
replace('packages/core/src/context/context-engine.ts','      !chunk ||\n      chunk.ref.sourceId !== ref.sourceId ||','      chunk?.ref.sourceId !== ref.sourceId ||')
replace('tests/integration/tasks.test.mjs','  assert.equal(hidden.statusCode, 404);','  // A forged project header is rejected before resource lookup.\n  assert.equal(hidden.statusCode, 403);\n  assert.doesNotMatch(hidden.body, /Remember 42/u);')
# Assign distinct attachment identities when the API collects image parts independently.
replace('apps/server/src/http/agent-api.ts','      images,\n      idempotencyKey: key,','      images: images.map((image,index)=>({...image,id:`input-image-${index}`})),\n      idempotencyKey: key,')
