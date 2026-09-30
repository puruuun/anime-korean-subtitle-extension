import { it, expect } from 'vitest';
import { completionText } from '../src/translation/completionResponse';
it('assembles SSE JSON without changing IDs or accepting truncated stream', () => {
  const data =
    'data: ' +
    JSON.stringify({ choices: [{ delta: { content: '{"translations":[' } }] }) +
    '\n\ndata: ' +
    JSON.stringify({
      choices: [{ delta: { content: '{"id":7,"text":"안녕"}]}' }, finish_reason: 'stop' }],
    }) +
    '\n\ndata: [DONE]\n';
  expect(JSON.parse(completionText(data)).translations[0].id).toBe(7);
  expect(() => completionText('data: {"choices":[{"delta":{"content":"partial"}}]}')).toThrow();
});
