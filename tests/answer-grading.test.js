const assert = require("node:assert/strict");
const handleRequest = require("../server.js");

const {
  scoreAnswerAgainstBank,
  normalizeTriviaAnswer,
  normalizeGradingStrictness,
  getLocalGradingThreshold,
  isAnswerCorrectByStrictness,
  shouldAskAiForSecondOpinion
} = handleRequest._test;

function assertAccepted(answer, acceptedAnswers, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.ok(score >= 0.82, `${message} expected accepted, got score ${score}`);
}

function assertRejected(answer, acceptedAnswers, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.ok(score < 0.82, `${message} expected rejected, got score ${score}`);
}

function assertAiReviewCandidate(answer, acceptedAnswers, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.ok(score < 0.82, `${message} should start as a local miss, got score ${score}`);
  assert.equal(shouldAskAiForSecondOpinion(answer, acceptedAnswers, score), true, `${message} should get AI review`);
}

function assertNoAiReview(answer, acceptedAnswers, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.equal(shouldAskAiForSecondOpinion(answer, acceptedAnswers, score), false, `${message} should not spend AI review`);
}

function assertStrictnessCorrect(answer, acceptedAnswers, strictness, expected, message) {
  assert.equal(isAnswerCorrectByStrictness(answer, acceptedAnswers, strictness), expected, message);
}

assert.equal(normalizeTriviaAnswer("Louis XIV"), "louis 14");
assert.equal(normalizeTriviaAnswer("lui 14th"), "lui 14");
assert.equal(normalizeGradingStrictness("FORGIVING"), "forgiving");
assert.equal(normalizeGradingStrictness(""), "normal");
assert.equal(getLocalGradingThreshold("forgiving"), 0.78);
assert.equal(getLocalGradingThreshold("strict"), 0.9);

const realNearMissCases = [
  ["vinsnt", ["Vincent van Gogh"], "misspelled distinctive first name"],
  ["vinsnt van gohg", ["Vincent van Gogh"], "messy full artist name"],
  ["vangoh", ["van Gogh"], "joined surname without a space"],
  ["albert e", ["Albert Einstein"], "initialed surname shorthand"]
];

assertAccepted("Jackle", ["Jackal"], "obvious Jackal misspelling");
assertAccepted("lui 14th", ["Louis XIV"], "Louis XIV numeric/phonetic alias");
assertAccepted("vicent", ["Vincent van Gogh"], "distinctive typo partial");
assertAccepted("magerihta", ["Margherita"], "messy Margherita letter swap");
assertAccepted("margarita", ["Margherita"], "common Margherita spelling mix-up");
assertAccepted("newyork", ["New York"], "joined place name");
assertAccepted("oppenhiemer", ["Oppenheimer"], "swapped-letter person/title answer");
assertAccepted("einsten", ["Albert Einstein"], "misspelled distinctive surname");
assertAccepted("phillandefia", ["Philadelphia"], "phonetic Philadelphia misspelling with inserted sound");
assertAccepted("filadelfia", ["Philadelphia"], "phonetic Philadelphia spelling");
realNearMissCases.forEach(([answer, acceptedAnswers, label]) => assertAiReviewCandidate(answer, acceptedAnswers, label));

assertRejected("cat", ["Jackal"], "unrelated animal");
assertRejected("pennsylvania", ["Philadelphia"], "related place but not the city");
assertRejected("14th", ["Louis XIV"], "number alone is too ambiguous");
assertRejected("marinara", ["Margherita"], "different pizza variety");
assertNoAiReview("", ["Vincent van Gogh"], "blank answer");
assertNoAiReview("zzzzzz", ["Vincent van Gogh"], "repeated-character gibberish");
assertNoAiReview("idk", ["Vincent van Gogh"], "filler answer");
assertNoAiReview("qwrtypsdf", ["Vincent van Gogh"], "vowelless keyboard mash");

assertStrictnessCorrect("Jackle", ["Jackal"], "forgiving", true, "forgiving accepts obvious typo");
assertStrictnessCorrect("Jackle", ["Jackal"], "normal", true, "normal accepts obvious typo");
assertStrictnessCorrect("vicent", ["Vincent van Gogh"], "strict", false, "strict asks for more than a rough partial");
assertStrictnessCorrect("Jackal", ["Jackal"], "exact", true, "exact accepts normalized exact match");
assertStrictnessCorrect("Jackle", ["Jackal"], "exact", false, "exact rejects typos");

const strictNearMissScore = scoreAnswerAgainstBank("vinsnt", ["Vincent van Gogh"]);
assert.equal(shouldAskAiForSecondOpinion("vinsnt", ["Vincent van Gogh"], strictNearMissScore, "forgiving"), true, "forgiving should review rough but useful answers");
assert.equal(shouldAskAiForSecondOpinion("vinsnt", ["Vincent van Gogh"], strictNearMissScore, "strict"), false, "strict should not review very rough partials");
const strictTypoScore = scoreAnswerAgainstBank("Vincnt van Goh", ["Vincent van Gogh"]);
assert.equal(shouldAskAiForSecondOpinion("Vincnt van Goh", ["Vincent van Gogh"], strictTypoScore, "strict"), true, "strict can review high-confidence spelling slips");
assert.equal(shouldAskAiForSecondOpinion("Vincnt van Goh", ["Vincent van Gogh"], strictTypoScore, "exact"), false, "exact never asks AI to rescue answers");

console.log("Answer grading tests passed.");
