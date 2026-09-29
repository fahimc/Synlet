"""Apply the pinned follow-up with the exact formatted browser-page guard."""
import subprocess

source = subprocess.check_output([
    'git', 'show', '24ab314547e50758cd176ba1f73d09430b839666:.review-followup.py'
], text=True)
old = "edit('packages/adapters/src/browser/playwright-browser.ts',lambda s:s.replace('this.context!.newPage()', 'this.context.newPage()'))"
new = "edit('packages/adapters/src/browser/playwright-browser.ts',lambda s:s.replace('const page = this.page!;', 'const page = this.page;\\n      if (!page) throw new DomainError(\"CAPABILITY_UNAVAILABLE\", \"Dedicated browser page is unavailable\");'))"
if old not in source:
    raise RuntimeError('Pinned follow-up mismatch')
source = source.replace(old, new)
exec(compile(source, 'review-followup-pinned.py', 'exec'))
