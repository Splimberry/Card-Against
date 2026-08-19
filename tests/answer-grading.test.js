const assert = require("node:assert/strict");
const handleRequest = require("../server.js");

const {
  scoreAnswerAgainstBank,
  normalizeTriviaAnswer,
  normalizeGradingStrictness,
  getLocalGradingThreshold,
  isAnswerCorrectByStrictness,
  shouldAskAiForSecondOpinion,
  normalizeSeedQuestion,
  pickBotAnswersForSetup,
  pickRoomBotAutoAnswer
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

function assertContextAiReviewCandidate(answer, acceptedAnswers, context, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.ok(score < 0.82, `${message} should start as a local miss, got score ${score}`);
  assert.equal(shouldAskAiForSecondOpinion(answer, acceptedAnswers, score, "normal", context), true, `${message} should get context-aware AI review`);
}

function assertNoContextAiReview(answer, acceptedAnswers, context, message) {
  const score = scoreAnswerAgainstBank(answer, acceptedAnswers);
  assert.equal(shouldAskAiForSecondOpinion(answer, acceptedAnswers, score, "normal", context), false, `${message} should not spend context-aware AI review`);
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

const nonsenseAnswerCases = [
  {
    answer: "qwertyuiop",
    acceptedAnswers: ["Eiffel Tower"],
    context: { question: "Which Paris landmark was built for the 1889 World's Fair?", theme: "Geography" },
    label: "top-row keyboard run"
  },
  {
    answer: "lkjhgfdsa",
    acceptedAnswers: ["Mercury"],
    context: { question: "Which planet is closest to the Sun?", theme: "Science" },
    label: "reversed home-row keyboard run"
  },
  {
    answer: "poiu ytrewq",
    acceptedAnswers: ["Mitochondria"],
    context: { question: "Which organelle is often called the powerhouse of the cell?", theme: "Science" },
    label: "split reversed keyboard walk"
  },
  {
    answer: "qwrtypsdf",
    acceptedAnswers: ["Vincent van Gogh"],
    context: { question: "Who painted Sunflowers?", theme: "Art" },
    label: "skipped-letter keyboard walk"
  },
  {
    answer: "ababababab",
    acceptedAnswers: ["Photosynthesis"],
    context: { question: "What process lets plants convert sunlight into chemical energy?", theme: "Science" },
    label: "repeated nonsense chunk"
  },
  {
    answer: "fjkjqxfskj",
    acceptedAnswers: ["Mount Everest"],
    context: { question: "What is the highest mountain above sea level?", theme: "Geography" },
    label: "rare-letter consonant mash"
  },
  {
    answer: "yegeygayegayfe",
    acceptedAnswers: ["Lightsaber"],
    context: { question: "Which glowing weapon does a Jedi usually use?", theme: "Film and TV" },
    label: "vowel-heavy fake syllable mash"
  },
  {
    answer: "yeg eyga yegayfe",
    acceptedAnswers: ["Lightsaber"],
    context: { question: "Which glowing weapon does a Jedi usually use?", theme: "Film and TV" },
    label: "split fake syllable mash"
  },
  {
    answer: "blorblorblorf",
    acceptedAnswers: ["Mitochondria"],
    context: { question: "Which organelle is often called the powerhouse of the cell?", theme: "Science" },
    label: "near-repeated fake word"
  },
  {
    answer: "lumalumalume",
    acceptedAnswers: ["Mars"],
    context: { question: "Which planet is known as the Red Planet?", theme: "Science" },
    label: "almost repeated fake syllables"
  },
  {
    answer: "efabhebahbaehebahebahbeahbeahbeahbeahbeahbeahbeahbeaheabhaehbea",
    acceptedAnswers: ["Lightsaber"],
    context: { question: "Which glowing weapon does a Jedi usually use?", theme: "Film and TV" },
    label: "long low-variety repeated chunk nonsense"
  },
  {
    answer: "abracadabraabracadabra",
    acceptedAnswers: ["Mitochondria"],
    context: { question: "Which organelle is often called the powerhouse of the cell?", theme: "Science" },
    label: "duplicated word loop"
  },
  {
    answer: "jffnjeksjenfskjeksn f",
    acceptedAnswers: ["Beethoven"],
    context: { question: "Which composer wrote Fur Elise?", theme: "Art and Music" },
    label: "long mixed keyboard mash"
  }
];

const meaningfulContextCases = [
  {
    answer: "van gogh",
    acceptedAnswers: ["vicent"],
    context: { question: "Who drew Sunflowers?", theme: "Art" },
    label: "question-context alias despite incomplete preset"
  },
  {
    answer: "li saber",
    acceptedAnswers: ["force sword"],
    context: { question: "Which glowing weapon does a Jedi usually use?", theme: "Film and TV" },
    label: "broken-spacing meaningful phrase"
  },
  {
    answer: "new york",
    acceptedAnswers: ["usa"],
    context: { question: "Which city is known as the Big Apple?", theme: "Geography" },
    label: "specific place answer despite weak preset"
  },
  {
    answer: "krzysztof",
    acceptedAnswers: ["director"],
    context: { question: "What is the first name of filmmaker Kieslowski?", theme: "Film and TV" },
    label: "rare-letter real name"
  },
  {
    answer: "onomatopoeia",
    acceptedAnswers: ["sound word"],
    context: { question: "What literary term describes words like buzz or hiss?", theme: "Art and Music" },
    label: "vowel-heavy real term"
  },
  {
    answer: "mississippi",
    acceptedAnswers: ["river"],
    context: { question: "Which major US river flows past Memphis?", theme: "Geo and History" },
    label: "repetitive real place name"
  },
  {
    answer: "pneumonoultramicroscopicsilicovolcanoconiosis",
    acceptedAnswers: ["lung disease"],
    context: { question: "What long word names a lung disease caused by fine silica dust?", theme: "Science" },
    label: "very long real science term"
  },
  {
    answer: "internationalization",
    acceptedAnswers: ["i18n"],
    context: { question: "What software term is often abbreviated i18n?", theme: "Gaming and Geek Culture" },
    label: "long repeated-ending real term"
  }
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
assertAccepted("yt", ["YouTube"], "common YouTube abbreviation");
assertAccepted("ig", ["Instagram"], "common Instagram abbreviation");
assertAccepted("js", ["JavaScript"], "common JavaScript abbreviation");
assertAccepted("usa", ["United States of America"], "common country abbreviation");
realNearMissCases.forEach(([answer, acceptedAnswers, label]) => assertAiReviewCandidate(answer, acceptedAnswers, label));
meaningfulContextCases.forEach(({ answer, acceptedAnswers, context, label }) => {
  assertContextAiReviewCandidate(answer, acceptedAnswers, context, `context should review ${label}`);
});

assertRejected("cat", ["Jackal"], "unrelated animal");
assertRejected("yt", ["TikTok"], "wrong platform abbreviation");
assertRejected("pennsylvania", ["Philadelphia"], "related place but not the city");
assertRejected("14th", ["Louis XIV"], "number alone is too ambiguous");
assertRejected("marinara", ["Margherita"], "different pizza variety");
assertNoAiReview("", ["Vincent van Gogh"], "blank answer");
assertNoAiReview("zzzzzz", ["Vincent van Gogh"], "repeated-character gibberish");
assertNoAiReview("idk", ["Vincent van Gogh"], "filler answer");
nonsenseAnswerCases.forEach(({ answer, acceptedAnswers, context, label }) => {
  assertNoAiReview(answer, acceptedAnswers, label);
  assertNoContextAiReview(answer, acceptedAnswers, context, `context gate rejects ${label}`);
});
assertNoContextAiReview("cat", ["vicent"], {
  question: "Who drew Sunflowers?",
  theme: "Art"
}, "short generic answer with no useful signal");
assertNoContextAiReview("zzzzzz", ["vicent"], {
  question: "Who drew Sunflowers?",
  theme: "Art"
}, "context gate still rejects gibberish");

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

const localizedBotQuestion = normalizeSeedQuestion({
  id: "zh-hans-test-bot-language",
  type: "text",
  theme: "Art and Music",
  difficulty: "medium",
  language: "zh-Hans",
  question: "哪位荷兰画家创作了《星月夜》？",
  canonicalAnswer: "文森特·梵高",
  acceptedAnswers: ["文森特·梵高", "梵高", "Vincent van Gogh", "Van Gogh"],
  botCards: ["伦勃朗", "约翰内斯·维米尔"]
});
assert.deepEqual(localizedBotQuestion.botCorrectPool, ["文森特·梵高", "梵高"], "Chinese bot pool removes English aliases when Chinese answers exist");
for (let seed = 0; seed < 16; seed += 1) {
  const botCards = pickBotAnswersForSetup(localizedBotQuestion, `bot-language-${seed}`);
  assert.ok(botCards.every((answer) => !/[A-Za-z]{2,}/.test(answer)), "Chinese setup bot answers stay localized");
  const autoAnswer = pickRoomBotAutoAnswer({
    code: "ZH01",
    game: {
      matchId: "zh-language-match",
      round: seed + 1,
      setup: {
        language: "zh-Hans",
        blackCard: localizedBotQuestion.blackCard,
        canonicalAnswer: localizedBotQuestion.canonicalAnswer,
        acceptedAnswers: localizedBotQuestion.acceptedAnswers,
        botCards
      }
    }
  }, { id: `bot-${seed}` }, seed);
  assert.ok(!/[A-Za-z]{2,}/.test(autoAnswer), "Chinese auto-submitted bot answers stay localized");
}

const englishAnswerChineseQuestion = normalizeSeedQuestion({
  id: "zh-hans-test-bot-english-answer",
  type: "text",
  theme: "Internet Culture",
  difficulty: "medium",
  language: "zh-Hans",
  question: "URL 中的 U 代表哪个英文单词？请用英文作答。",
  canonicalAnswer: "uniform",
  acceptedAnswers: ["uniform"],
  botCards: ["universal", "user"]
});
assert.deepEqual(englishAnswerChineseQuestion.botCorrectPool, ["uniform"], "Chinese prompts that require English preserve their English bot answer pool");

const englishOnlyChineseQuestion = normalizeSeedQuestion({
  id: "zh-hans-test-bot-fallback",
  type: "text",
  theme: "Internet Culture",
  difficulty: "medium",
  language: "zh-Hans",
  question: "这个网络地址的协议缩写是什么？",
  canonicalAnswer: "HTTP",
  acceptedAnswers: ["HTTP"],
  botCards: ["FTP", "SMTP"]
});
assert.deepEqual(englishOnlyChineseQuestion.botCorrectPool, [], "Chinese prompts without an English-answer instruction do not retain English aliases for bots");
assert.deepEqual(englishOnlyChineseQuestion.botCards, ["不确定", "不知道"], "Chinese prompts without localized bot answers use Chinese fallbacks");
for (let seed = 0; seed < 8; seed += 1) {
  const botCards = pickBotAnswersForSetup(englishOnlyChineseQuestion, `bot-fallback-${seed}`);
  assert.ok(botCards.every((answer) => /[\u3400-\u9fff]/u.test(answer)), "Chinese setup fallback answers stay in Chinese");
  const autoAnswer = pickRoomBotAutoAnswer({
    code: "ZH02",
    game: {
      matchId: "zh-fallback-match",
      round: seed + 1,
      setup: {
        language: "zh-Hans",
        blackCard: englishOnlyChineseQuestion.blackCard,
        canonicalAnswer: englishOnlyChineseQuestion.canonicalAnswer,
        acceptedAnswers: englishOnlyChineseQuestion.acceptedAnswers,
        botCards
      }
    }
  }, { id: `fallback-bot-${seed}` }, seed);
  assert.ok(/[\u3400-\u9fff]/u.test(autoAnswer), "Chinese auto-submit fallback answers stay in Chinese");
}

console.log("Answer grading tests passed.");
