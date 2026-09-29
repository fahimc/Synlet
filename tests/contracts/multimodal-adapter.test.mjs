import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { LlamaServerAdapter } from "../../packages/adapters/dist/index.js";

test("native tokenizer/template and real image content reach inference; no whitespace estimates", async (t) => {
  const captured = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text || "{}");
    captured.push({ path: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/apply-template")
      return res.end(JSON.stringify({ prompt: "NATIVE TEMPLATE <__media__>" }));
    if (req.url === "/tokenize")
      return res.end(JSON.stringify({ tokens: [1, 2, 3, 4, 5, 6, 7] }));
    if (req.url === "/completion")
      return res.end(
        JSON.stringify({ tokens_evaluated: 777, truncated: false }),
      );
    if (req.url === "/v1/chat/completions") {
      res.setHeader("content-type", "text/event-stream");
      return res.end(
        'data: {"choices":[{"delta":{"content":"blue circle"}}]}\n\ndata: {"choices":[{"finish_reason":"stop","delta":{}}],"usage":{"prompt_tokens":777,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      );
    }
    if (req.url === "/models/unload") return res.end('{"success":true}');
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const model = {
    modelId: "vision-fixture",
    enabled: true,
    capabilities: {
      text: true,
      image: true,
      tools: false,
      structuredOutput: false,
      maxContextTokens: 8192,
    },
  };
  const adapter = new LlamaServerAdapter(
    `http://127.0.0.1:${server.address().port}`,
    "fixture",
    [model],
  );
  assert.equal(await adapter.countInput(model.modelId, "oneword"), 7);
  const image = { id: "pic", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
  const request = {
    requestId: "req",
    modelId: model.modelId,
    prompt: "What shape?",
    images: [image],
    maxOutputTokens: -1,
    deadlineUtc: new Date(Date.now() + 10000).toISOString(),
    allowedTools: [],
    reasoning: "enabled",
  };
  const events = [];
  for await (const e of adapter.generate(request, new AbortController().signal))
    events.push(e);
  const completion = captured.find((c) => c.path === "/v1/chat/completions");
  assert.equal(
    completion.body.messages.at(-1).content[1].image_url.url,
    image.dataUrl,
  );
  assert.equal(completion.body.max_tokens, 8192 - 777 - 256);
  assert.equal(completion.body.chat_template_kwargs.enable_thinking, true);
  assert.equal(events.at(-1).finish, "stop");
});
