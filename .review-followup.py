from pathlib import Path
import json, re

p=Path('tests/e2e/browser.test.mjs');s=p.read_text(encoding='utf-8')
old='''  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
'''
if old not in s: raise RuntimeError('Expected browser cleanup not found')
s=s.replace(old,'')
s=s.replace('  context.after(() => browser.close());','''  context.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });''')
s=s.replace('test("dedicated Playwright session inspects and observes an owned fixture", async (context) => {','test("dedicated Playwright session inspects and observes an owned fixture", {timeout:60000}, async (context) => {')
p.write_text(s,encoding='utf-8')

p=Path('docs/architecture/synlet.proposed.json');config=json.loads(p.read_text(encoding='utf-8'))
config['status']='DESIGN_REFERENCE_USE_CONFIG_PROFILES_FOR_RUNTIME'
config['blueprint_version']='0.3-full-control'
config['execution'].update({'mode':'full-control','shell_default':'unrestricted','external_writes':'allowed_as_authenticated_launch_user','command_allowlist':False,'semantic_execution_routes':False,'workspace_is_sandbox':False,'operator_authentication':'required','unknown_effects':'reconcile_before_replay'})
config['scheduler']['max_resident_generative_models']=1
config['build']['default_mode']='local'
config['build']['node_baseline']='24.21.0 (current tested runtime lock)'
config['architecture']['default_tenancy']='single-authenticated-operator'
p.write_text(json.dumps(config,indent=2)+'\n',encoding='utf-8')

p=Path('README.md');s=p.read_text(encoding='utf-8')
s=s.replace('> retrieval are measured, and no cloud model or OpenAI account is required.','> retrieval use the local runtime; CPU engineering tests are separate from live model-quality measurements. No cloud model or OpenAI account is required.')
s=s.replace('workspace files, and run non-interactive host commands.','host files (including paths outside the workspace), delete accessible files, and run arbitrary non-interactive host commands.')
s=s.replace('instructions, allowed tools and completion checks to the controller.','instructions, suggested tools and completion checks to the controller. Skills do not restrict the full-control tool catalogue.')
s=s.replace('pnpm test:security\npnpm test:e2e','pnpm test:security\npnpm test:context\npnpm test:python-contracts\npnpm test:e2e')
needle='## Start here'
addition='''## Independent model evaluation

`pnpm eval:harness` evaluates the actual shared agent path, including multi-turn memory, using exact independent answer checks and persisted traces. See [the model evaluation runbook](docs/runbooks/model-evaluation.md) for private suites, operator-token setup and an optional `SYNLET_MODEL_STRATEGY=controller-only` comparison with the same unrestricted tools. The ten bundled cases are public regression fixtures, not a private benchmark or proof of general PC-management quality. The default strategy remains `adaptive`.

'''
s=s.replace(needle,addition+needle,1)
p.write_text(s,encoding='utf-8')

# The self-contained HTML downloads must agree with the active repository guidance.
p=Path('docs/architecture/synlet-soma-architecture.html');s=p.read_text(encoding='utf-8')
paths={'agents':'AGENTS.md','brief':'docs/CODEX_BUILD_BRIEF.md','backlog':'docs/BUILD_BACKLOG.md','prompt':'CODEX_START_PROMPT.txt','skill':'.agents/skills/synlet-build/SKILL.md','ports':'docs/architecture/ports.example.ts','progress':'docs/progress/PROGRESS_TEMPLATE.md','modules':'docs/MODULE_MAP.md'}
def update_script(identifier, fn):
    global s
    pattern=r'(<script\b(?=[^>]*\bid=[\"\x27]'+re.escape(identifier)+r'[\"\x27])[^>]*>)([\s\S]*?)(</script>)'
    match=re.search(pattern,s)
    if not match: raise RuntimeError('Missing embedded HTML payload: '+identifier)
    payload=fn(json.loads(match.group(2)))
    text=json.dumps(payload,ensure_ascii=True).replace('<','\\u003c')
    s=s[:match.start(2)]+text+s[match.end(2):]
def downloads(entries):
    for key,path in paths.items():
        if key in entries:
            entries[key]['text']=Path(path).read_text(encoding='utf-8')
    return entries
update_script('manifest-data',lambda _:config)
update_script('build-export-data',downloads)
p.write_text(s,encoding='utf-8')
