from pathlib import Path
import json

def replace(path,old,new):
    p=Path(path);s=p.read_text(encoding='utf-8')
    if old not in s:raise RuntimeError('Missing expected source: '+path)
    p.write_text(s.replace(old,new,1),encoding='utf-8')

replace('packages/core/src/orchestration/agent-harness.ts','export interface AgentHarnessOptions {','export interface AgentHarnessOptions {\n  readonly modelStrategy?: "adaptive" | "controller-only";')
replace('packages/core/src/orchestration/agent-harness.ts','        const routingGoal = failure','        if (this.options.modelStrategy === "controller-only") {\n          return {route:{modelVersion:"controller-only-comparison",capabilities:{code:false,math:false,vision:false},probabilities:{code:0,math:0,vision:0}}};\n        }\n        const routingGoal = failure')
replace('packages/core/src/orchestration/agent-harness.ts','executionMode: "full-control",','executionMode: "full-control",\n          modelStrategy: this.options.modelStrategy ?? "adaptive",')
replace('apps/server/src/bootstrap/services.ts','  const compactor = new ModelSourcePreservingCompactor(','  const modelStrategy = process.env.SYNLET_MODEL_STRATEGY ?? "adaptive";\n  if (modelStrategy !== "adaptive" && modelStrategy !== "controller-only") throw new DomainError("INVALID_OUTPUT", "Unknown SYNLET_MODEL_STRATEGY");\n  const compactor = new ModelSourcePreservingCompactor(')
replace('apps/server/src/bootstrap/services.ts','    firstLlm.modelId,\n    300_000,','    modelStrategy === "controller-only" ? controller.modelId : firstLlm.modelId,\n    300_000,')
replace('apps/server/src/bootstrap/services.ts','      specialists,\n      maxPending:','      specialists: modelStrategy === "controller-only" ? [] : specialists,\n      modelStrategy,\n      maxPending:')
p=Path('package.json');data=json.loads(p.read_text());data['scripts']['eval:harness']='node scripts/eval-harness.mjs';p.write_text(json.dumps(data,indent=2)+'\n')
