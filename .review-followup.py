"""Apply the pinned final browser/document patch with every HTML export aligned."""
import subprocess
source = subprocess.check_output([
    'git', 'show', '73d15fd10b6137c00e088c9caae0a6b4ce5fe9e0:.review-followup.py'
], text=True)
source = source.replace("'prompt':'CODEX_START_PROMPT.txt'", "'kickoff':'CODEX_START_PROMPT.txt'")
exec(compile(source, 'review-final-browser-docs.py', 'exec'))
