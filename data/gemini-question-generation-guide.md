# Gemini Question Generation Guide

## Prompt To Paste Into Gemini

Generate new trivia questions for my web game. Do not duplicate or closely reword any existing question listed below.

Rules:
- Use these exact themes: Pop Culture, Gaming and Geek Culture, Geo and History, Animals, Food and Drinks, Sports, Internet Culture, Science, Mythology.
- Generate questions in sets of 10 per theme.
- For each theme set, difficulty distribution must be exactly: 5 easy, 4 medium, 1 hard.
- For each theme set, exactly 5 questions must be image questions and exactly 5 must be text-only questions.
- Image questions must include a stable direct image URL, preferably Wikimedia Commons or another stable public source.
- Avoid image URLs likely to expire, login-gated images, temporary CDN thumbnails, or images with large text overlays.
- Questions should be fair and fun: not too niche, not painfully obvious.
- Easy should be broadly recognizable; medium should require some knowledge; hard should be answerable by fans or enthusiasts, not obscure trivia archaeology.
- Keep answers short. Most answers should be 1-4 words.
- Include acceptedAnswers with aliases, abbreviations, common misspellings, nicknames, plural/singular variants, and alternate spellings.
- Include 2 plausible wrong botCards per question. Bot answers should be believable but not correct.
- For image questions, the image must directly identify or strongly guide the answer. For example, if asking about Rust the programming language mascot, do not use actual metal rust.
- Do not use questions that rely on reading tiny text in the image.
- Avoid duplicates across the new batch too.

Return valid JSON as an array of objects. Use this exact shape:

```json
[
  {
    "id": "theme-short-unique-id",
    "type": "image",
    "theme": "Pop Culture",
    "difficulty": "easy",
    "question": "Question text here?",
    "image": {
      "url": "https://stable-image-url.example/image.jpg",
      "alt": "Short factual image description",
      "credit": "Source name"
    },
    "canonicalAnswer": "Answer",
    "acceptedAnswers": ["answer", "alternate answer"],
    "botCards": ["Wrong answer 1", "Wrong answer 2"]
  },
  {
    "id": "theme-short-unique-id",
    "type": "text",
    "theme": "Pop Culture",
    "difficulty": "medium",
    "question": "Question text here?",
    "canonicalAnswer": "Answer",
    "acceptedAnswers": ["answer", "alternate answer"],
    "botCards": ["Wrong answer 1", "Wrong answer 2"]
  }
]
```

Before finalizing, self-check every theme set:
- Exactly 10 questions per theme.
- Exactly 5 easy, 4 medium, 1 hard per theme.
- Exactly 5 image and 5 text-only questions per theme.
- No duplicate answers or near-duplicate questions from the existing list below.

## Existing Questions To Avoid

### Pop Culture
1. [easy; image] Answer: Lightsaber | Question: What is the name of this elegant weapon wielded by Jedi and Sith in the Star Wars universe?
2. [easy; text] Answer: Wakanda | Question: Black Panther is the king of which fictional African nation?
3. [medium; image] Answer: Central Perk | Question: What is the name of the fictional New York coffee shop where the main characters frequently gather?
4. [medium; image] Answer: Dunder Mifflin | Question: This character in this sitcom works for which fictional paper company?
5. [medium; text] Answer: Heisenberg | Question: What alias does high school chemistry teacher Walter White adopt when he enters the drug trade?
6. [medium; image] Answer: Spinning top | Question: In the Christopher Nolan film Inception, what object does Cobb use as his totem to check if he is dreaming?
7. [easy; text] Answer: Swifties | Question: What is the official collective nickname used for dedicated fans of pop star Taylor Swift?
8. [medium; text] Answer: James Cameron | Question: Which filmmaker directed the 1997 epic romance and disaster film Titanic?
9. [medium; image] Answer: Smeagol | Question: What is the original hobbit name of the creature Gollum before he was corrupted by the One Ring?
10. [hard; text] Answer: A log | Question: In the cult classic TV series Twin Peaks, what object does Margaret Lanterman famously carry around and claim to communicate with?

### Gaming and Geek Culture
1. [easy; image] Answer: Creeper | Question: What is the name of this iconic explosive enemy from the sandbox game Minecraft?
2. [medium; text] Answer: GLaDOS | Question: What is the name of the passive-aggressive, cake-promising artificial intelligence that guides and tests you in Portal?
3. [easy; image] Answer: Pinky | Question: What is the specific name of the pink ghost in the classic arcade game Pac-Man?
4. [easy; image] Answer: Pikachu | Question: Which specific Electric-type creature serves as the official mascot for the entire Pokemon franchise?
5. [medium; image] Answer: Triforce | Question: What is the name of this sacred golden relic representing Power, Wisdom, and Courage in the Legend of Zelda series?
6. [medium; text] Answer: Fus Ro Dah | Question: In The Elder Scrolls V: Skyrim, what are the three words of power that make up the iconic Unrelenting Force shout?
7. [medium; image] Answer: Crowbar | Question: What specific tool serves as the signature melee weapon of protagonist Gordon Freeman in the Half-Life series?
8. [medium; image] Answer: Pip-Boy | Question: What is the name of the wrist-mounted electronic device used by characters in the Fallout series to manage inventory and view stats?
9. [hard; text] Answer: Kaer Morhen | Question: What is the name of the old mountain fortress that serves as the guild training school for the Witchers of the Wolf School?
10. [hard; text] Answer: Gwyn | Question: Who is the final boss of the original Dark Souls game, known as the Lord of Cinder?

### Geo and History
1. [easy; image] Answer: Egypt | Question: In which modern-day country can you visit these ancient royal tombs located on the Giza Plateau?
2. [easy; image] Answer: Rome | Question: In which European capital city is this ancient Roman amphitheater located?
3. [easy; image] Answer: Canada | Question: This leaf design is the central symbol on the national flag of which country?
4. [medium; text] Answer: Amazon River | Question: Which South American river is recognized as the largest river in the world by water discharge volume?
5. [medium; image] Answer: Mount Fuji | Question: What is the name of this snow-capped active stratovolcano, which is also the highest mountain in Japan?
6. [medium; text] Answer: Pompeii | Question: Which ancient Roman city was buried and preserved under feet of volcanic ash following the eruption of Mount Vesuvius in 79 AD?
7. [medium; text] Answer: Canberra | Question: What is the federal capital city of Australia, chosen as a compromise between rivals Sydney and Melbourne?
8. [hard; image] Answer: Louis XIV | Question: Known as the Sun King, which French monarch ordered the expansion of the hunting lodge that became the Palace of Versailles?
9. [hard; text] Answer: Magna Carta | Question: What is the name of the royal charter of rights agreed to by King John of England at Runnymede in 1215?
10. [medium; image] Answer: Machu Picchu | Question: What is the name of this 15th-century Inca citadel located in the Eastern Cordillera of southern Peru?

### Animals
1. [easy; image] Answer: Lion | Question: What is the common name of this large wild felid species, famous for the prominent mane found on adult males?
2. [easy; image] Answer: Giant Panda | Question: Native to south central China, what animal relies on bamboo for over 99% of its natural diet?
3. [easy; text] Answer: Cheetah | Question: What is the name of the world's fastest land mammal, capable of reaching speeds over 60 miles per hour in short bursts?
4. [medium; image] Answer: Platypus | Question: What unique semi-aquatic Australian mammal is known for having a duck-like bill, webbed feet, and laying eggs?
5. [easy; image] Answer: Kangaroo | Question: What is the name of this large Australian marsupial that hops on its powerful hind legs?
6. [medium; text] Answer: Blue Whale | Question: What marine mammal is scientifically recognized as the largest animal ever known to have lived on Earth?
7. [medium; image] Answer: Chameleon | Question: What kind of specialized lizard is famous for its independently moving eyes, projectile tongue, and ability to change color?
8. [medium; image] Answer: Narwhal | Question: Often called the unicorn of the sea, what Arctic whale species features a large spiraled tusk projecting from its jaw?
9. [hard; image] Answer: Axolotl | Question: What is the name of this critically endangered Mexican salamander known for retaining its larval features, including external gills, into adulthood?
10. [medium; text] Answer: Pride | Question: What specific collective noun is used to describe a social group or family unit of lions living together?

### Food and Drinks
1. [easy; image] Answer: Sushi | Question: What traditional Japanese staple dish consists of vinegared rice combined with ingredients like raw seafood and vegetables wrapped in nori?
2. [easy; image] Answer: Croissant | Question: What is the name of this flaky, buttery, crescent-shaped pastry deeply associated with French bakeries?
3. [medium; text] Answer: Scoville scale | Question: What measurement scale is used to rank the pungent heat and spiciness of chili peppers?
4. [easy; image] Answer: Avocado | Question: What pear-shaped, green-fleshed fruit serves as the primary base ingredient for guacamole?
5. [medium; image] Answer: Margherita | Question: What classic Neapolitan pizza variety is topped specifically with red tomatoes, white mozzarella, and green basil leaves?
6. [medium; text] Answer: Tofu | Question: What common vegetarian protein source is made by coagulating soy milk and pressing the resulting curds into soft white blocks?
7. [medium; image] Answer: Espresso | Question: What style of concentrated coffee drink is brewed by forcing hot water under high pressure through finely-ground beans?
8. [medium; image] Answer: Macaron | Question: What is the name of this sweet French meringue-based confection made with almond flour and sandwiching a filling?
9. [hard; text] Answer: Saffron | Question: Derived from the crimson threads of a specific crocus flower, what is widely considered the most expensive spice by weight in the world?
10. [hard; text] Answer: Haggis | Question: What traditional savory pudding containing sheep's pluck mixed with oats and spices is celebrated as the national dish of Scotland?

### Sports
1. [easy; image] Answer: Olympic Games | Question: What major global sporting event is represented by these five interlocking colored rings?
2. [easy; text] Answer: Soccer | Question: Which sport's international federation organizes the FIFA World Cup tournament every four years?
3. [easy; image] Answer: Tennis | Question: What sport uses this specific felt-covered neon yellow ball and a netted racket?
4. [easy; image] Answer: Basketball | Question: Invented by James Naismith, what sport requires players to shoot a ball through this elevated metal rim and net?
5. [medium; image] Answer: Curling | Question: What winter sport involves players sliding thick polished granite stones across a sheet of ice toward a target area?
6. [medium; text] Answer: Birdie | Question: In the game of golf, what term describes scoring exactly one stroke under par on a specific hole?
7. [medium; image] Answer: Baseball | Question: What sport is played on a field arranged with four bases configuration known as a diamond?
8. [medium; image] Answer: Shuttlecock | Question: What is the official name of the feathered projectile hit back and forth across the net in badminton?
9. [medium; text] Answer: 26.2 miles | Question: What is the standard official length of a modern long-distance running marathon in miles?
10. [medium; text] Answer: Foil, Epee, or Sabre | Question: Name any one of the three bladed weapons used in Olympic fencing.

### Internet Culture
1. [easy; image] Answer: Doge | Question: What is the internet name of this famous Shiba Inu dog that inspired a viral meme format and cryptocurrency?
2. [easy; image] Answer: Wikipedia | Question: This unfinished puzzle globe is the logo for which massive multilingual online encyclopedia?
3. [easy; text] Answer: Fear of missing out | Question: In internet acronym slang, what does the four-letter abbreviation 'FOMO' stand for?
4. [medium; image] Answer: YouTube | Question: What video sharing platform awards this physical silver play button plaque to creators who reach 100,000 subscribers?
5. [medium; image] Answer: Snoo | Question: What is the name of this white alien creature that serves as the official mascot for the website Reddit?
6. [medium; text] Answer: Rickrolling | Question: What internet prank involves tricking someone into clicking a link that unexpectedly opens Rick Astley's 'Never Gonna Give You Up' music video?
7. [medium; image] Answer: Distracted Boyfriend | Question: What is the common name of this stock photo turned iconic meme about divided attention and new attractions?
8. [easy; image] Answer: Bitcoin | Question: This orange insignia represents which decentralized digital cryptocurrency launched in 2009?
9. [medium; text] Answer: Too long; didn't read | Question: Commonly placed before a brief text summary online, what does the shorthand expression 'TL;DR' stand for?
10. [hard; text] Answer: just setting up my twttr | Question: In 2006, Twitter co-founder Jack Dorsey published the platform's first public tweet. What did the short text message say?

### Science
1. [easy; image] Answer: Hydrogen | Question: What is the name of the chemical element represented by the letter H on the periodic table?
2. [easy; image] Answer: Saturn | Question: What is the name of this sixth planet from the Sun, famous for its extensive and prominent planetary ring system?
3. [easy; image] Answer: Double Helix | Question: What is the name given to the twisted ladder shape of a DNA molecule structure?
4. [medium; text] Answer: Albert Einstein | Question: Which theoretical physicist developed the theory of relativity and formulated the mass-energy equivalence equation E=mc²?
5. [medium; image] Answer: Mitochondrion | Question: Often nicknamed the powerhouse of the cell, what organelle generates most of the cell's supply of adenosine triphosphate (ATP)?
6. [medium; text] Answer: Diamond | Question: According to the Mohs hardness scale, what crystalline form of carbon is recognized as the hardest naturally occurring mineral?
7. [medium; image] Answer: Orion | Question: What prominent celestial constellation is easily recognized by the alignment of three bright stars forming a hunter's belt?
8. [medium; text] Answer: Light | Question: In physics, the constant 'c' represents the maximum speed of what entity traveling through a perfect vacuum?
9. [easy; text] Answer: Water | Question: What common chemical compound is composed of two hydrogen atoms bonded to a single oxygen atom?
10. [hard; text] Answer: Chlorophyll | Question: What is the chemical name of the green pigment found in plants that absorbs light energy to drive photosynthesis?

### Mythology
1. [easy; image] Answer: Zeus | Question: Who is this supreme ruler of Mount Olympus and Greek god of the sky, weather, and thunderbolts?
2. [medium; image] Answer: Anubis | Question: What is the name of this ancient Egyptian god of mummification and the afterlife, traditionally depicted with the head of a jackal?
3. [easy; text] Answer: Mjolnir | Question: In Norse mythology, what is the name of Thor's magical, short-handled war hammer capable of channeling lightning?
4. [easy; image] Answer: Medusa | Question: What is the name of the monstrous Gorgon sister from Greek myth who features venomous snakes in place of hair?
5. [medium; text] Answer: Valhalla | Question: In Norse mythology, what is the name of Odin's majestic, gold-bright hall in Asgard where half of those who die in combat are led?
6. [medium; text] Answer: Achilles | Question: Which hero of the Trojan War was invulnerable in all of his body except for his heel, which ultimately led to his downfall?
7. [medium; image] Answer: Pegasus | Question: What is the name of the famous mythical winged stallion born from the blood of the slain Gorgon Medusa?
8. [medium; image] Answer: Yggdrasil | Question: What is the name of the immense, sacred ash tree that connects the nine worlds of Norse cosmology?
9. [medium; text] Answer: Cerberus | Question: What is the name of the multi-headed hound that guards the gates of the Greek Underworld to prevent the dead from leaving?
10. [hard; text] Answer: Romulus | Question: According to the foundation myth of Rome, which twin brother killed Remus and went on to become the very first king of the city?
