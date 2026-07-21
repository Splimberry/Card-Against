const assert = require("node:assert/strict");
const handleRequest = require("../server.js");

const { scoreAnswerAgainstBank, normalizeTriviaAnswer } = handleRequest._test;

function assertAccepted(answer, acceptedAnswers, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.ok(score >= 0.82, `${message} expected accepted, got score ${score}`);
}

function assertRejected(answer, acceptedAnswers, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.ok(score < 0.82, `${message} expected rejected, got score ${score}`);
}

assert.equal(normalizeTriviaAnswer("Louis XIV"), "louis 14");
assert.equal(normalizeTriviaAnswer("lui 14th"), "lui 14");

assertAccepted("Jackle", ["Jackal"], "obvious Jackal misspelling");
assertAccepted("lui 14th", ["Louis XIV"], "Louis XIV numeric/phonetic alias");
assertAccepted("vicent", ["Vincent van Gogh"], "distinctive typo partial");

assertRejected("cat", ["Jackal"], "unrelated animal");
assertRejected("14th", ["Louis XIV"], "number alone is too ambiguous");

console.log("Answer grading tests passed.");
