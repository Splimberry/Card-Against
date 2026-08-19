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
  normalizeLocalizedAcceptedAnswers,
  getAnswerMarkingContext,
  createLocalRoundResult,
  getAiSecondOpinionCandidates,
  buildRoundPrompt,
  buildRoundSecondOpinionPrompt,
  validateRoundResult,
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

const multilingualChinesePayload = {
  mode: "room",
  questionLanguage: "zh-Hans",
  roomQuestionLanguage: "zh-Hans",
  multilingualAnswers: true,
  triviaTheme: "Sports",
  blackCard: "温布尔登网球公开赛传统上使用哪种场地表面？",
  canonicalAnswer: "草地",
  acceptedAnswers: ["草地", "草"],
  rejectedAnswers: [],
  gradingStrictness: "normal",
  image: { url: "", alt: "", credit: "" },
  englishMarkingContext: {
    source: "english-counterpart",
    language: "en",
    theme: "Sports",
    question: "What surface is traditionally used at the Wimbledon tennis tournament?",
    canonicalAnswer: "grass",
    acceptedAnswers: ["grass", "lawn", "grass court"],
    rejectedAnswers: [],
    gradingStrictness: "normal",
    image: { url: "", alt: "", credit: "" }
  },
  answerCards: [
    { owner: "chinese-player", label: "Chinese Player", answer: "草地", bot: false },
    { owner: "english-player", label: "English Player", answer: "grass", bot: false }
  ],
  botCards: [],
  botLabels: [],
  matchContext: {},
  roundSeed: "multilingual-test"
};

const chineseAnswerContext = getAnswerMarkingContext(multilingualChinesePayload, "草地");
assert.equal(chineseAnswerContext.source, "question-language", "Chinese answers keep the Chinese question context");
assert.equal(chineseAnswerContext.chineseNativeAnswer, true, "Chinese room answers activate the Chinese AI criterion");
const englishAnswerContext = getAnswerMarkingContext(multilingualChinesePayload, "grass");
assert.equal(englishAnswerContext.source, "english-counterpart", "English answers use the paired English marking context");
assert.equal(englishAnswerContext.question, multilingualChinesePayload.englishMarkingContext.question);
assert.deepEqual(createLocalRoundResult(multilingualChinesePayload).correctIndexes, [0, 1], "Chinese and English answers can both pass against their own contexts");

const chinesePrompt = JSON.parse(buildRoundPrompt(multilingualChinesePayload));
assert.ok(Array.isArray(chinesePrompt.submittedAnswers[0].markingContext.chineseAnswerCriteria), "Chinese answer prompt includes Chinese marking criteria");
assert.equal(Object.hasOwn(chinesePrompt.submittedAnswers[1].markingContext, "chineseAnswerCriteria"), false, "English answer prompt does not include Chinese marking criteria");
assert.equal(chinesePrompt.submittedAnswers[1].markingContext.question, multilingualChinesePayload.englishMarkingContext.question, "English prompt context comes from the English counterpart");

const literalEnglishAnswerContext = getAnswerMarkingContext({
  ...multilingualChinesePayload,
  blackCard: "URL 中的 U 代表哪个英文单词？请用英文作答。",
  canonicalAnswer: "uniform",
  acceptedAnswers: ["uniform"]
}, "统一");
assert.equal(literalEnglishAnswerContext.chineseNativeAnswer, false, "Chinese criteria do not override a prompt that explicitly requires an English answer");

const multilingualDisabledPayload = {
  ...multilingualChinesePayload,
  multilingualAnswers: false
};
assert.deepEqual(createLocalRoundResult(multilingualDisabledPayload).correctIndexes, [0], "English answers do not fall back when multilingual answers are disabled");
const disabledEnglishAnswerContext = getAnswerMarkingContext(multilingualDisabledPayload, "grass");
assert.equal(disabledEnglishAnswerContext.foreignLanguageAnswerRejected, true, "disabled multilingual answers reject a foreign-language answer before AI review");
const disabledPrompt = JSON.parse(buildRoundPrompt(multilingualDisabledPayload));
assert.equal(disabledPrompt.submittedAnswers[1].markingContext.rejectForeignLanguageAnswer, true, "disabled multilingual answers tell the AI to reject the foreign-language response");
assert.equal(getAiSecondOpinionCandidates(multilingualDisabledPayload, createLocalRoundResult(multilingualDisabledPayload)).some((candidate) => candidate.answer === "grass"), false, "disabled multilingual answers do not send foreign-language responses to AI review");
assert.deepEqual(
  validateRoundResult({
    cards: ["草地", "grass"],
    winnerIndex: 1,
    correctIndexes: [0, 1]
  }, multilingualDisabledPayload).correctIndexes,
  [0],
  "server-side validation cannot let forced AI grading override a disabled multilingual setting"
);

const nativeEnglishNameContext = getAnswerMarkingContext({
  ...multilingualDisabledPayload,
  blackCard: "《我的世界》原始创作者马库斯·佩尔松使用的网络别名是什么？",
  canonicalAnswer: "Notch",
  acceptedAnswers: ["Notch"]
}, "Notch");
assert.equal(nativeEnglishNameContext.foreignLanguageAnswerRejected, false, "a native answer bank can still intentionally require an English proper name");

const symbolicAnswerPayload = {
  ...multilingualChinesePayload,
  blackCard: "水的化学式是什么？",
  canonicalAnswer: "H2O",
  acceptedAnswers: ["H2O"],
  englishMarkingContext: {
    ...multilingualChinesePayload.englishMarkingContext,
    question: "What is the chemical formula for water?",
    canonicalAnswer: "water",
    acceptedAnswers: ["water"]
  },
  answerCards: [
    { owner: "formula-player", label: "Formula Player", answer: "H2O", bot: false },
    { owner: "other-player", label: "Other Player", answer: "water", bot: false }
  ]
};
assert.equal(getAnswerMarkingContext(symbolicAnswerPayload, "H2O").source, "question-language", "symbolic answers remain in the native question context");
assert.deepEqual(createLocalRoundResult(symbolicAnswerPayload).correctIndexes, [0, 1], "a formula stays local while a word answer can use the English counterpart");

const chineseAiCandidatePayload = {
  ...multilingualChinesePayload,
  blackCard: "中国哪所大学常被简称为北大？",
  canonicalAnswer: "北京大学",
  acceptedAnswers: ["北京大学"],
  englishMarkingContext: null,
  answerCards: [
    { owner: "candidate-player", label: "Candidate Player", answer: "北大", bot: false },
    { owner: "other-player", label: "Other Player", answer: "清华", bot: false }
  ]
};
const chineseAiCandidateLocalResult = createLocalRoundResult(chineseAiCandidatePayload);
const chineseAiCandidates = getAiSecondOpinionCandidates(chineseAiCandidatePayload, chineseAiCandidateLocalResult);
assert.equal(chineseAiCandidates[0]?.markingContext.chineseNativeAnswer, true, "plausible Chinese aliases reach the Chinese AI review path");
const chineseSecondOpinionPrompt = JSON.parse(buildRoundSecondOpinionPrompt(chineseAiCandidatePayload, chineseAiCandidates));
assert.ok(Array.isArray(chineseSecondOpinionPrompt.candidateAnswers[0]?.markingContext.chineseAnswerCriteria), "Chinese second-opinion prompts include the Chinese marking criteria");

assert.deepEqual(
  normalizeLocalizedAcceptedAnswers({ language: "zh-Hans", blackCard: "哪位荷兰画家创作了《星月夜》？" }, ["文森特·梵高", "梵高", "Vincent van Gogh", "Van Gogh"]),
  ["文森特·梵高", "梵高"],
  "Chinese question answer banks discard foreign-language aliases"
);
assert.deepEqual(
  normalizeLocalizedAcceptedAnswers({ language: "zh-Hans", blackCard: "在 macOS 上，Cmd 配合哪个按键可以重新载入网页？请用英文单个字母作答。" }, ["R"]),
  ["R"],
  "literal English-letter prompts preserve their answer bank"
);

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
assert.deepEqual(localizedBotQuestion.acceptedAnswers, ["文森特·梵高", "梵高"], "Chinese question records remove English aliases from acceptedAnswers");
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
