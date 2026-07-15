# Gemini Question Expansion Guide

Copy this whole file into Gemini when asking it to generate more questions for the game.

## Prompt To Paste Into Gemini

Generate new trivia questions for my web game. Do not duplicate, closely reword, or reuse the same answer as any existing question listed in this file.

Rules:
- Use these exact themes: Pop Culture, Gaming and Geek Culture, Geo and History, Animals, Food and Drinks, Sports, Internet Culture, Science, Mythology, Art and Music.
- Generate questions in sets of 10 per theme.
- For each theme set, difficulty distribution must be exactly: 5 easy, 4 medium, 1 hard.
- For each theme set, exactly 5 questions must be image questions and exactly 5 must be text-only questions.
- Use new IDs that do not appear in the existing list. IDs should be lowercase kebab-case, theme-prefixed, and unique.
- Image questions must include a stable direct image URL, preferably Wikimedia Commons, official public media pages, or other stable public sources.
- Avoid temporary CDN thumbnails, login-gated images, hotlinked search thumbnails, images likely to expire, or images with large text overlays.
- Do not use questions that rely on reading tiny text in the image.
- Questions should be fair and fun: easy should be broadly recognizable, medium should require some knowledge, and hard should be answerable by fans or enthusiasts without being obscure trivia archaeology.
- Keep answers short. Most answers should be 1-4 words.
- Include acceptedAnswers with aliases, abbreviations, common misspellings, nicknames, plural/singular variants, and alternate spellings.
- Include exactly 2 plausible wrong botCards per question. Bot answers should be believable but clearly incorrect.
- For image questions, the image must directly identify or strongly guide the answer. Do not use misleading images.
- Avoid duplicate answers across the new batch too.
- Return only valid JSON as one array of objects. Do not include markdown fences or explanation in the final answer.

Use this exact object shape:

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

Before finalizing, self-check every generated theme set:
- Exactly 10 questions per theme.
- Exactly 5 easy, 4 medium, 1 hard per theme.
- Exactly 5 image and 5 text-only questions per theme.
- No duplicate IDs, answers, or near-duplicate question wording from the existing list below.
- Every image question has a usable image object. Every text question has no image object.

## Current Question Bank Summary

Total existing questions: 200

| Theme | Total | Image | Text | Easy | Medium | Hard |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pop Culture | 20 | 11 | 9 | 8 | 10 | 2 |
| Gaming and Geek Culture | 20 | 14 | 6 | 8 | 9 | 3 |
| Geo and History | 20 | 12 | 8 | 8 | 9 | 3 |
| Animals | 20 | 15 | 5 | 9 | 9 | 2 |
| Food and Drinks | 20 | 16 | 4 | 8 | 9 | 3 |
| Sports | 20 | 12 | 8 | 9 | 10 | 1 |
| Internet Culture | 20 | 16 | 4 | 9 | 9 | 2 |
| Science | 20 | 15 | 5 | 9 | 9 | 2 |
| Mythology | 20 | 12 | 8 | 8 | 10 | 2 |
| Art and Music | 20 | 16 | 4 | 10 | 8 | 2 |

## Existing Questions To Avoid

### Pop Culture

1. ID: popculture-starwars-lightsaber | image; easy | Answer: Lightsaber | Accepted: lightsaber, light saber, lightsabers | Question: What is the name of this elegant weapon wielded by Jedi and Sith in the Star Wars universe?
2. ID: popculture-marvel-wakanda | text; easy | Answer: Wakanda | Accepted: wakanda | Question: Black Panther is the king of which fictional African nation?
3. ID: popculture-friends-centralperk | image; medium | Answer: Central Perk | Accepted: central perk, central perk coffee shop | Question: What is the name of the fictional New York coffee shop where the main characters frequently gather?
4. ID: popculture-office-dundermifflin | image; medium | Answer: Dunder Mifflin | Accepted: dunder mifflin, dunder mifflin paper company | Question: This character in this sitcom works for which fictional paper company?
5. ID: popculture-breakingbad-walter | text; medium | Answer: Heisenberg | Accepted: heisenberg | Question: What alias does high school chemistry teacher Walter White adopt when he enters the drug trade?
6. ID: popculture-inception-totem | image; medium | Answer: Spinning top | Accepted: spinning top, top, a spinning top, totem top | Question: In the Christopher Nolan film Inception, what object does Cobb use as his totem to check if he is dreaming?
7. ID: popculture-taylorswift-swifties | text; easy | Answer: Swifties | Accepted: swifties, swiftie | Question: What is the official collective nickname used for dedicated fans of pop star Taylor Swift?
8. ID: popculture-titanic-cameron | text; medium | Answer: James Cameron | Accepted: james cameron, cameron | Question: Which filmmaker directed the 1997 epic romance and disaster film Titanic?
9. ID: popculture-lord-of-the-rings-gollum | image; medium | Answer: Smeagol | Accepted: smeagol, sméagol | Question: What is the original hobbit name of the creature Gollum before he was corrupted by the One Ring?
10. ID: popculture-twinpeaks-loglady | text; hard | Answer: A log | Accepted: log, a log, wood log | Question: In the cult classic TV series Twin Peaks, what object does Margaret Lanterman famously carry around and claim to communicate with?
11. ID: popculture-matrix-redpill | image; easy | Answer: Red | Accepted: red, red pill, the red pill | Question: In the 1999 sci-fi film The Matrix, what color is the pill Neo takes to discover the truth about reality?
12. ID: popculture-frozen-arendelle | text; easy | Answer: Arendelle | Accepted: arendelle | Question: What is the name of the fictional Scandinavian kingdom ruled by Elsa and Anna in Disney's Frozen?
13. ID: popculture-harrypotter-sortinghat | image; easy | Answer: Sorting Hat | Accepted: sorting hat, the sorting hat | Question: What is the name of this sentient magical artifact used at Hogwarts to determine which house a new student belongs to?
14. ID: popculture-shrek-ogre | image; easy | Answer: Shrek | Accepted: shrek | Question: What is the name of this iconic green DreamWorks animation character who lives in a swamp?
15. ID: popculture-ghostbusters-ecto1 | image; easy | Answer: Ghostbusters | Accepted: ghostbusters, the ghostbusters | Question: This modified 1959 Cadillac Miller-Meteor ambulance serves as the signature vehicle for which fictional team?
16. ID: popculture-thesimpsons-springfield | text; medium | Answer: Springfield | Accepted: springfield | Question: What is the name of the fictional American town where Homer, Marge, Bart, Lisa, and Maggie Simpson reside?
17. ID: popculture-theoffice-dundie | text; medium | Answer: Dundie | Accepted: dundie, dundies, dundie award, the dundies | Question: What is the name of the fictional, plastic trophy awards hosted annually by Michael Scott for his employees in The Office?
18. ID: popculture-bttf-delorean | image; medium | Answer: DeLorean | Accepted: delorean, dmc-12, delorean dmc-12 | Question: What is the specific make or model of this sports car that Doc Brown modifies into a time machine in Back to the Future?
19. ID: popculture-jurassicpark-mosquito | image; medium | Answer: Amber | Accepted: amber, fossilized amber | Question: In the film Jurassic Park, what type of fossilized material preserves the ancient insect used to harvest dinosaur DNA?
20. ID: popculture-parasite-oscar | text; hard | Answer: Parasite | Accepted: parasite, gisaengchung | Question: Directed by Bong Joon Ho, which 2019 satirical thriller made history by becoming the first non-English language film to win the Academy Award for Best Picture?

### Gaming and Geek Culture

1. ID: gaming-minecraft-creeper | image; easy | Answer: Creeper | Accepted: creeper, creepars | Question: What is the name of this iconic explosive enemy from the sandbox game Minecraft?
2. ID: gaming-portal-glados | text; medium | Answer: GLaDOS | Accepted: glados, glados ai | Question: What is the name of the passive-aggressive, cake-promising artificial intelligence that guides and tests you in Portal?
3. ID: gaming-pacman-ghosts | image; easy | Answer: Pinky | Accepted: pinky | Question: What is the specific name of the pink ghost in the classic arcade game Pac-Man?
4. ID: gaming-pokemon-pikachu | image; easy | Answer: Pikachu | Accepted: pikachu | Question: Which specific Electric-type creature serves as the official mascot for the entire Pokémon franchise?
5. ID: gaming-zelda-triforce | image; medium | Answer: Triforce | Accepted: triforce, the triforce | Question: What is the name of this sacred golden relic representing Power, Wisdom, and Courage in the Legend of Zelda series?
6. ID: gaming-skyrim-fusrodah | text; medium | Answer: Fus Ro Dah | Accepted: fus ro dah, fusrodah | Question: In The Elder Scrolls V: Skyrim, what are the three words of power that make up the iconic Unrelenting Force shout?
7. ID: gaming-halflife-crowbar | image; medium | Answer: Crowbar | Accepted: crowbar, a crowbar | Question: What specific tool serves as the signature melee weapon of protagonist Gordon Freeman in the Half-Life series?
8. ID: gaming-fallout-pipboy | image; medium | Answer: Pip-Boy | Accepted: pip-boy, pip boy, pipboy | Question: What is the name of the wrist-mounted electronic device used by characters in the Fallout series to manage inventory and view stats?
9. ID: gaming-witcher-kaermorhen | image; hard | Answer: Kaer Morhen | Accepted: kaer morhen | Question: What is the name of the old mountain fortress that serves as the guild training school for the Witchers of the Wolf School?
10. ID: gaming-darksouls-gwyn | image; hard | Answer: Gwyn | Accepted: gwyn, lord gwyn, gwyn, lord of cinder | Question: Who is the final boss of the original Dark Souls game, known as the Lord of Cinder?
11. ID: gaming-mario-mushroom | image; easy | Answer: Super Mushroom | Accepted: super mushroom, super mario mushroom, mario super mushroom | Question: What is the name of this classic power-up item from the Super Mario franchise that causes Mario to grow in size?
12. ID: gaming-halflife-lambda | image; easy | Answer: Lambda | Accepted: lambda | Question: This character is the lower-case form of which Greek letter, famously used as the logo for the Half-Life video game series?
13. ID: gaming-pacman-fruit | image; easy | Answer: Strawberry | Accepted: strawberry, strawberries | Question: In the classic arcade game Pac-Man, what fruit is the second-lowest scoring bonus item after the cherry?
14. ID: gaming-pokemon-ball | image; easy | Answer: Poké Ball | Accepted: poke ball, pokeball, poké ball, pokéball | Question: What is the general name of the spherical devices used by trainers to capture, contain, and carry wild creatures in the Pokémon series?
15. ID: gaming-tetris-blocks | text; easy | Answer: Tetrominoes | Accepted: tetrominoes, tetromino, tetrimino, tetriminoes, blocks | Question: The geometric puzzle pieces manipulated by players in the legendary video game Tetris are collectively known by what name?
16. ID: gaming-fallout-caps | text; medium | Answer: Bottle Caps | Accepted: bottle caps, bottle cap, caps | Question: What everyday disposable objects serve as the primary standardized currency throughout the post-apocalyptic wasteland of the Fallout series?
17. ID: gaming-skyrim-sweetroll | image; medium | Answer: Sweetroll | Accepted: sweetroll, sweet roll, sweetrolls | Question: What specific baked pastry is frequently mentioned by guards in Skyrim who mockingly ask if someone stole yours?
18. ID: gaming-halo-ring | text; medium | Answer: Ring | Accepted: ring, ringworld, torus, halo ring | Question: What geometric shape describes the titular megastructures in the Halo video game series, which serve as habitable worlds and superweapons?
19. ID: gaming-bioshock-rapture | image; medium | Answer: Rapture | Accepted: rapture, city of rapture | Question: What is the name of the dystopian, underwater objectivist city that serves as the primary setting for the first two BioShock games?
20. ID: gaming-wow-leeroy | text; hard | Answer: Leeroy | Accepted: leeroy, leeroy jenkins | Question: What first name is shared by the legendary World of Warcraft player character who went viral in 2005 for charging blindly into a dungeon while shouting his own name?

### Geo and History

1. ID: geohistory-egypt-pyramids | image; easy | Answer: Egypt | Accepted: egypt, arab republic of egypt | Question: In which modern-day country can you visit these ancient royal tombs located on the Giza Plateau?
2. ID: geohistory-italy-colosseum | image; easy | Answer: Rome | Accepted: rome, roma | Question: In which European capital city is this ancient Roman amphitheater located?
3. ID: geohistory-canada-maple | image; easy | Answer: Canada | Accepted: canada | Question: This leaf design is the central symbol on the national flag of which country?
4. ID: geohistory-amazon-river | text; medium | Answer: Amazon River | Accepted: amazon, amazon river, rio amazonas | Question: Which South American river is recognized as the largest river in the world by water discharge volume?
5. ID: geohistory-japan-fuji | image; medium | Answer: Mount Fuji | Accepted: mount fuji, mt fuji, fuji, fujisan | Question: What is the name of this snow-capped active stratovolcano, which is also the highest mountain in Japan?
6. ID: geohistory-rome-pompeii | text; medium | Answer: Pompeii | Accepted: pompeii, pompei | Question: Which ancient Roman city was buried and preserved under feet of volcanic ash following the eruption of Mount Vesuvius in 79 AD?
7. ID: geohistory-australia-canberra | text; medium | Answer: Canberra | Accepted: canberra | Question: What is the federal capital city of Australia, chosen as a compromise between rivals Sydney and Melbourne?
8. ID: geohistory-france-louisxiv | image; hard | Answer: Louis XIV | Accepted: louis xiv, louis 14, louis the fourteenth, king louis xiv | Question: Known as the Sun King, which French monarch ordered the expansion of the hunting lodge that became the Palace of Versailles?
9. ID: geohistory-uk-magnacarta | image; hard | Answer: Magna Carta | Accepted: magna carta, magna carta libertatum | Question: What is the name of the royal charter of rights agreed to by King John of England at Runnymede in 1215?
10. ID: geohistory-peru-machupicchu | image; medium | Answer: Machu Picchu | Accepted: machu picchu, machupicchu | Question: What is the name of this 15th-century Inca citadel located in the Eastern Cordillera of southern Peru?
11. ID: geohistory-usa-statue | image; easy | Answer: New York City | Accepted: new york city, new york, nyc, new york harbor | Question: A gift from France to the United States, this colossal neoclassical sculpture is located in which harbor city?
12. ID: geohistory-france-tower | image; easy | Answer: Paris | Accepted: paris | Question: Constructed as the centerpiece of the 1889 World's Fair, this iconic iron lattice tower is located in which European capital?
13. ID: geohistory-china-wall | image; easy | Answer: China | Accepted: china, peoples republic of china, prc | Question: Built across historical northern borders to protect against nomadic incursions, this massive ancient fortification system is located in which modern country?
14. ID: geohistory-india-taj | image; medium | Answer: Taj Mahal | Accepted: taj mahal | Question: Commissioned in 1632 by the Mughal emperor Shah Jahan to house the tomb of his favorite wife, what is the name of this white marble mausoleum?
15. ID: geohistory-uk-stonehenge | image; medium | Answer: Stonehenge | Accepted: stonehenge | Question: Located on Salisbury Plain in Wiltshire, England, what is the name of this famous prehistoric monument consisting of a ring of standing stones?
16. ID: geohistory-japan-tokyo | text; easy | Answer: Tokyo | Accepted: tokyo | Question: Which Asian metropolis holds the distinction of being the most populous metropolitan area in the world?
17. ID: geohistory-egypt-cleopatra | text; easy | Answer: Cleopatra | Accepted: cleopatra, cleopatra vii | Question: Which famous female pharaoh was the last active ruler of the Ptolemaic Kingdom of Egypt before it became a Roman province?
18. ID: geohistory-atlantic-ocean | text; medium | Answer: Atlantic Ocean | Accepted: atlantic, atlantic ocean, the atlantic | Question: Which ocean separates the continents of North and South America from Europe and Africa?
19. ID: geohistory-usa-lincoln | text; medium | Answer: Abraham Lincoln | Accepted: abraham lincoln, lincoln, abe lincoln | Question: Which US President issued the Emancipation Proclamation and led the nation during the American Civil War?
20. ID: geohistory-russia-alaska | text; hard | Answer: Russian Empire | Accepted: russia, russian empire, the russian empire | Question: In 1867, the United States purchased the territory that became the state of Alaska from which foreign empire?

### Animals

1. ID: animals-lion-male | image; easy | Answer: Lion | Accepted: lion, african lion, panthera leo | Question: What is the common name of this large wild felid species, famous for the prominent mane found on adult males?
2. ID: animals-panda-giant | image; easy | Answer: Giant Panda | Accepted: giant panda, panda, panda bear | Question: Native to south central China, what animal relies on bamboo for over 99% of its natural diet?
3. ID: animals-cheetah-speed | text; easy | Answer: Cheetah | Accepted: cheetah, acinonyx jubatus | Question: What is the name of the world's fastest land mammal, capable of reaching speeds over 60 miles per hour in short bursts?
4. ID: animals-platypus-mammal | image; medium | Answer: Platypus | Accepted: platypus, duck-billed platypus | Question: What unique semi-aquatic Australian mammal is known for having a duck-like bill, webbed feet, and laying eggs?
5. ID: animals-kangaroo-pouch | image; easy | Answer: Kangaroo | Accepted: kangaroo, red kangaroo | Question: What is the name of this large Australian marsupial that hops on its powerful hind legs?
6. ID: animals-bluewhale-size | text; medium | Answer: Blue Whale | Accepted: blue whale, balaenoptera musculus | Question: What marine mammal is scientifically recognized as the largest animal ever known to have lived on Earth?
7. ID: animals-chameleon-eyes | image; medium | Answer: Chameleon | Accepted: chameleon, chameleons | Question: What kind of specialized lizard is famous for its independently moving eyes, projectile tongue, and ability to change color?
8. ID: animals-narwhal-tusk | image; medium | Answer: Narwhal | Accepted: narwhal, narwhale | Question: Often called the unicorn of the sea, what Arctic whale species features a large spiraled tusk projecting from its jaw?
9. ID: animals-axolotl-amphibian | image; hard | Answer: Axolotl | Accepted: axolotl, mexican walking fish | Question: What is the name of this critically endangered Mexican salamander known for retaining its larval features, including external gills, into adulthood?
10. ID: animals-pride-lions | text; medium | Answer: Pride | Accepted: pride, a pride | Question: What specific collective noun is used to describe a social group or family unit of lions living together?
11. ID: animals-capybara-rodent | image; easy | Answer: Capybara | Accepted: capybara, capybaras, hydrochoerus hydrochaeris | Question: Native to South America, what semi-aquatic mammal holds the biological distinction of being the largest living rodent in the world?
12. ID: animals-komodo-dragon | image; easy | Answer: Komodo Dragon | Accepted: komodo dragon, komodo, varanus komodoensis | Question: Endemic to a few Indonesian islands, what is the specific name of the largest living species of lizard on Earth?
13. ID: animals-peregrine-falcon | image; easy | Answer: Peregrine Falcon | Accepted: peregrine falcon, peregrine, falco peregrinus | Question: Famous for its high-speed hunting stoop, what specific bird of prey is recognized as the fastest member of the animal kingdom?
14. ID: animals-lemur-madagascar | image; easy | Answer: Madagascar | Accepted: madagascar, republic of madagascar | Question: Characterized by large eyes and often long, ringed tails, this group of primates is found in the wild exclusively on what island nation?
15. ID: animals-orca-dolphin | image; easy | Answer: Dolphin | Accepted: dolphin, dolphins, delphinidae, oceanic dolphin | Question: Despite its common name featuring the word 'whale', the apex predator known as the Killer Whale actually belongs to which specific marine mammal family?
16. ID: animals-tardigrade-moss | image; medium | Answer: Tardigrades | Accepted: tardigrade, tardigrades, tardigrada, water bear, moss piglet | Question: Commonly known as 'water bears' or 'moss piglets', what resilient microscopic animals are famous for surviving extreme conditions like outer space?
17. ID: animals-koala-diet | text; medium | Answer: Eucalyptus | Accepted: eucalyptus, eucalyptus leaves, gum tree | Question: To the exclusion of almost everything else, the highly specialized diet of the Australian koala consists entirely of the leaves of which specific plant family?
18. ID: animals-murder-crows | text; medium | Answer: Murder | Accepted: murder, a murder, murder of crows | Question: Steeped in historical folklore, what ominous collective noun is used specifically to describe a flock of crows?
19. ID: animals-moray-eel | image; medium | Answer: Moray Eel | Accepted: moray, moray eel, moray eels, muraenidae | Question: Which family of predatory marine eels possesses a unique second set of 'pharyngeal' jaws inside their throats to drag captured prey into their esophagus?
20. ID: animals-lyrebird-mimic | image; hard | Answer: Lyrebird | Accepted: lyrebird, lyrebirds, superb lyrebird | Question: Native to Australia, which ground-dwelling bird species is famous for its unmatched ability to mimic complex natural and artificial sounds, including chainsaws and camera shutters?

### Food and Drinks

1. ID: fooddrinks-sushi-roll | image; easy | Answer: Sushi | Accepted: sushi, maki | Question: What traditional Japanese staple dish consists of vinegared rice combined with ingredients like raw seafood and vegetables wrapped in nori?
2. ID: fooddrinks-croissant-pastry | image; easy | Answer: Croissant | Accepted: croissant, croissants | Question: What is the name of this flaky, buttery, crescent-shaped pastry deeply associated with French bakeries?
3. ID: fooddrinks-scoville-scale | text; medium | Answer: Scoville scale | Accepted: scoville, scoville scale, scoville heat units, shu | Question: What measurement scale is used to rank the pungent heat and spiciness of chili peppers?
4. ID: fooddrinks-avocado-guacamole | image; easy | Answer: Avocado | Accepted: avocado, avocados | Question: What pear-shaped, green-fleshed fruit serves as the primary base ingredient for guacamole?
5. ID: fooddrinks-pizza-margherita | image; medium | Answer: Margherita | Accepted: margherita, pizza margherita | Question: What classic Neapolitan pizza variety is topped specifically with red tomatoes, white mozzarella, and green basil leaves?
6. ID: fooddrinks-tofu-soybean | text; medium | Answer: Tofu | Accepted: tofu, bean curd | Question: What common vegetarian protein source is made by coagulating soy milk and pressing the resulting curds into soft white blocks?
7. ID: fooddrinks-espresso-coffee | image; medium | Answer: Espresso | Accepted: espresso | Question: What style of concentrated coffee drink is brewed by forcing hot water under high pressure through finely-ground beans?
8. ID: fooddrinks-macaron-cookie | image; medium | Answer: Macaron | Accepted: macaron, macarons | Question: What is the name of this sweet French meringue-based confection made with almond flour and sandwiching a filling?
9. ID: fooddrinks-saffron-crocus | text; hard | Answer: Saffron | Accepted: saffron | Question: Derived from the crimson threads of a specific crocus flower, what is widely considered the most expensive spice by weight in the world?
10. ID: fooddrinks-haggis-scotland | text; hard | Answer: Haggis | Accepted: haggis | Question: What traditional savory pudding containing sheep's pluck mixed with oats and spices is celebrated as the national dish of Scotland?
11. ID: fooddrinks-kimchi-korea | image; easy | Answer: Kimchi | Accepted: kimchi, gimchi | Question: What is the name of this traditional Korean side dish consisting of salted and fermented vegetables, most commonly napa cabbage and radishes?
12. ID: fooddrinks-hummus-chickpea | image; easy | Answer: Hummus | Accepted: hummus, houmous | Question: What is the name of this popular Middle Eastern dip or spread made from cooked, mashed chickpeas blended with tahini, olive oil, and lemon juice?
13. ID: fooddrinks-gnocchi-potato | image; easy | Answer: Gnocchi | Accepted: gnocchi, potato gnocchi | Question: What is the name of this variety of small, thick Italian dumplings made from potato, flour, and egg, often featuring ridges pressed by a fork?
14. ID: fooddrinks-gelato-italian | image; easy | Answer: Gelato | Accepted: gelato | Question: What is the specific name for the Italian style of ice cream that uses more milk than cream, resulting in a denser and smoother texture?
15. ID: fooddrinks-churros-pastry | image; easy | Answer: Churros | Accepted: churros, churro | Question: Originating in Spain and Portugal, what is the name of these fried choux pastry snacks dusted in cinnamon sugar and often served with warm chocolate dip?
16. ID: fooddrinks-fondue-cheese | image; medium | Answer: Fondue | Accepted: fondue, cheese fondue | Question: What is the name of the traditional Swiss communal dish consisting of a pot of melted cheeses, white wine, and garlic, kept hot over a portable stove for dipping bread?
17. ID: fooddrinks-poutine-quebec | image; medium | Answer: Poutine | Accepted: poutine | Question: Originating in the province of Quebec, what iconic Canadian dish consists of French fries topped with fresh cheese curds and brown gravy?
18. ID: fooddrinks-kombucha-tea | image; medium | Answer: Kombucha | Accepted: kombucha, kefir tea | Question: What is the name of the effervescent, sweetened, black or green tea drink that is fermented using a symbiotic colony of bacteria and yeast?
19. ID: fooddrinks-ceviche-peru | image; medium | Answer: Ceviche | Accepted: ceviche, sebiche, seviche | Question: What is the national dish of Peru, consisting of fresh raw fish cured in fresh citrus juices, most commonly lemon or lime, and spiced with chili peppers?
20. ID: fooddrinks-foiegras-duck | image; hard | Answer: Foie Gras | Accepted: foie gras, foiegras | Question: What controversial French luxury delicacy is made from the liver of a duck or goose that has been specially fattened through a force-feeding process?

### Sports

1. ID: sports-olympics-rings | image; easy | Answer: Olympic Games | Accepted: olympics, olympic games, the olympics, summer olympics, winter olympics | Question: What major global sporting event is represented by these five interlocking colored rings?
2. ID: sports-soccer-worldcup | text; easy | Answer: Soccer | Accepted: soccer, football, association football | Question: Which sport's international federation organizes the FIFA World Cup tournament every four years?
3. ID: sports-tennis-ball | image; easy | Answer: Tennis | Accepted: tennis | Question: What sport uses this specific felt-covered neon yellow ball and a netted racket?
4. ID: sports-basketball-hoop | image; easy | Answer: Basketball | Accepted: basketball | Question: Invented by James Naismith, what sport requires players to shoot a ball through this elevated metal rim and net?
5. ID: sports-curling-stone | image; medium | Answer: Curling | Accepted: curling | Question: What winter sport involves players sliding thick polished granite stones across a sheet of ice toward a target area?
6. ID: sports-golf-birdie | text; medium | Answer: Birdie | Accepted: birdie | Question: In the game of golf, what term describes scoring exactly one stroke under par on a specific hole?
7. ID: sports-baseball-diamond | image; medium | Answer: Baseball | Accepted: baseball | Question: What sport is played on a field arranged with four bases configuration known as a diamond?
8. ID: sports-badminton-shuttlecock | image; medium | Answer: Shuttlecock | Accepted: shuttlecock, birdie | Question: What is the official name of the feathered projectile hit back and forth across the net in badminton?
9. ID: sports-marathon-distance | text; medium | Answer: 26.2 miles | Accepted: 26.2, 26.2 miles, 26 miles and 385 yards | Question: What is the standard official length of a modern long-distance running marathon in miles?
10. ID: sports-fencing-weapons | text; medium | Answer: Foil, Epee, or Sabre | Accepted: foil, epee, épée, sabre, saber | Question: Name any one of the three bladed weapons used in Olympic fencing.
11. ID: sports-wimbledon-surface | text; easy | Answer: Grass | Accepted: grass, lawn, grass court | Question: What traditional court surface material is famously used at the prestigious Wimbledon Championships in England?
12. ID: sports-archery-target | image; easy | Answer: Gold | Accepted: gold, yellow | Question: In the Olympic sport of target archery, what color is the central, highest-scoring ring of the target?
13. ID: sports-bobsleigh-crew | image; easy | Answer: Bobsleigh | Accepted: bobsleigh, bobsled, bobsledding | Question: What is the name of this high-speed winter sport where teams of two or four make timed runs down narrow, twisting, banked ice tracks in a gravity-powered sled?
14. ID: sports-baseball-positions | image; easy | Answer: Catcher | Accepted: catcher, the catcher | Question: In standard baseball, which defensive position player stands directly behind home plate to catch pitches that the batter does not hit?
15. ID: sports-rugby-players | text; easy | Answer: 15 | Accepted: 15, fifteen | Question: In a standard match of international Rugby Union, exactly how many active players from each team are allowed on the field at the same time?
16. ID: sports-snooker-balls | image; medium | Answer: 15 | Accepted: 15, fifteen | Question: In the cue sport of snooker, how many standard red balls are placed on the table at the beginning of a frame?
17. ID: sports-tourdefrance-jersey | text; medium | Answer: Yellow | Accepted: yellow, yellow jersey, maillot jaune | Question: In the multi-stage Tour de France cycling race, what color jersey is awarded daily to the overall leader of the general classification?
18. ID: sports-rowing-coxswain | image; medium | Answer: Coxswain | Accepted: coxswain, cox | Question: What is the specific title given to the non-rowing crew member who sits at the stern of a racing shell to steer the boat, execute strategy, and direct the rhythm of the rowers?
19. ID: sports-basketball-traveling | image; medium | Answer: Traveling | Accepted: traveling, travelling, travel | Question: What specific basketball violation occurs when a player takes too many steps without dribbling the ball, or moves their established pivot foot illegally?
20. ID: sports-puck-material | text; hard | Answer: Vulcanized Rubber | Accepted: vulcanized rubber, rubber, vulcanised rubber | Question: To prevent it from bouncing uncontrollably off the ice during gameplay, an official National Hockey League (NHL) puck is manufactured out of what specific cold-molded material?

### Internet Culture

1. ID: internet-twitter-doge | image; easy | Answer: Doge | Accepted: doge, kabosu | Question: What is the internet name of this famous Shiba Inu dog that inspired a viral meme format and cryptocurrency?
2. ID: internet-wikipedia-logo | image; easy | Answer: Wikipedia | Accepted: wikipedia | Question: This unfinished puzzle globe is the logo for which massive multilingual online encyclopedia?
3. ID: internet-slang-fomomeaning | text; easy | Answer: Fear of missing out | Accepted: fear of missing out | Question: In internet acronym slang, what does the four-letter abbreviation 'FOMO' stand for?
4. ID: internet-youtube-playbutton | image; medium | Answer: YouTube | Accepted: youtube | Question: What video sharing platform awards this physical silver play button plaque to creators who reach 100,000 subscribers?
5. ID: internet-reddit-snoo | image; medium | Answer: Snoo | Accepted: snoo | Question: What is the name of this white alien creature that serves as the official mascot for the website Reddit?
6. ID: internet-slang-rickroll | text; medium | Answer: Rickrolling | Accepted: rickroll, rickrolling, rick-rolling, rick-roll | Question: What internet prank involves tricking someone into clicking a link that unexpectedly opens Rick Astley's 'Never Gonna Give You Up' music video?
7. ID: internet-meme-distractedboyfriend | image; medium | Answer: Distracted Boyfriend | Accepted: distracted boyfriend, distracted boyfriend meme, man looking at another woman | Question: What is the common name of this stock photo turned iconic meme about divided attention and new attractions?
8. ID: internet-bitcoin-logo | image; easy | Answer: Bitcoin | Accepted: bitcoin, btc | Question: This orange insignia represents which decentralized digital cryptocurrency launched in 2009?
9. ID: internet-slang-tldr | text; medium | Answer: Too long; didn't read | Accepted: too long didn't read, too long; didn't read, too long, didn't read | Question: Commonly placed before a brief text summary online, what does the shorthand expression 'TL;DR' stand for?
10. ID: internet-history-firsttweet | text; hard | Answer: just setting up my twttr | Accepted: just setting up my twttr, just setting up my twitter | Question: In 2006, Twitter co-founder Jack Dorsey published the platform's first public tweet. What did the short text message say?
11. ID: internet-harhar-freddy | image; easy | Answer: Freddy Fazbear | Accepted: freddy fazbear, freddy, five nights at freddys, five nights at freddy's, fnaf freddy | Question: What is the name of this animatronic bear character who became the subject of the viral 'Har Har Har Har' beatboxing meme on TikTok?
12. ID: internet-grumpycat-tardar | image; easy | Answer: Grumpy Cat | Accepted: grumpy cat | Question: What is the common internet nickname of this famous frowning cat meme?
13. ID: internet-keyboard-cat | image; easy | Answer: Keyboard | Accepted: keyboard, electronic keyboard, musical keyboard, synth keyboard | Question: In the classic early YouTube meme, Keyboard Cat appears to play what specific instrument?
14. ID: internet-skibidi-toilet | image; easy | Answer: Skibidi Toilet | Accepted: skibidi toilet, skibidi | Question: Created by Alexey Gerasimov using Source Filmmaker, what viral YouTube series features a bizarre ongoing war between human-headed toilets and humanoids with hardware for heads?
15. ID: internet-backrooms-creepypasta | image; easy | Answer: The Backrooms | Accepted: the backrooms, backrooms | Question: Originating from a 4chan board in 2019, what viral urban legend describes an endless labyrinth of empty, yellow-hued, fluorescent-lit office rooms that you enter by 'nocliping' out of reality?
16. ID: internet-stonks-man | image; medium | Answer: Stonks | Accepted: stonks | Question: Featuring a generic 3D-rendered bald head standing in front of a stock market chart, what misspelled word serves as the title of this financial reaction meme?
17. ID: internet-fine-dog | image; medium | Answer: Fire | Accepted: fire, flames, a fire | Question: Originally from K.C. Green's webcomic *Gunshow*, a famous reaction image shows a cartoon dog calmly sitting at a table saying 'This is fine' while surrounded by what hazard?
18. ID: internet-steve-minecraft | image; medium | Answer: Steve | Accepted: steve, minecraft steve | Question: What default first name was given by Mojang developers to the iconic, blue-shirted male player avatar in Minecraft?
19. ID: internet-pepe-frog | image; medium | Answer: Pepe the Frog | Accepted: pepe, pepe the frog | Question: What is the name of this green frog meme character created by Matt Furie for the comic *Boy's Club*?
20. ID: internet-badluckbrian-kyle | image; hard | Answer: Kyle | Accepted: kyle, kyle craven | Question: What is the actual first name of the real person whose awkward, braces-wearing 7th-grade yearbook photo became the legendary 'Bad Luck Brian' image macro?

### Science

1. ID: science-periodic-h | image; easy | Answer: Hydrogen | Accepted: hydrogen | Question: What is the name of the chemical element represented by the letter H on the periodic table?
2. ID: science-space-saturn | image; easy | Answer: Saturn | Accepted: saturn | Question: What is the name of this sixth planet from the Sun, famous for its extensive and prominent planetary ring system?
3. ID: science-dna-structure | image; easy | Answer: Double Helix | Accepted: double helix, helix | Question: What is the name given to the twisted ladder shape of a DNA molecule structure?
4. ID: science-physics-einstein | text; medium | Answer: Albert Einstein | Accepted: albert einstein, einstein | Question: Which theoretical physicist developed the theory of relativity and formulated the mass-energy equivalence equation E=mc²?
5. ID: science-biology-mitochondria | image; medium | Answer: Mitochondrion | Accepted: mitochondrion, mitochondria | Question: Often nicknamed the powerhouse of the cell, what organelle generates most of the cell's supply of adenosine triphosphate (ATP)?
6. ID: science-geology-diamond | text; medium | Answer: Diamond | Accepted: diamond | Question: According to the Mohs hardness scale, what crystalline form of carbon is recognized as the hardest naturally occurring mineral?
7. ID: science-space-constellation | image; medium | Answer: Orion | Accepted: orion, orion the hunter | Question: What prominent celestial constellation is easily recognized by the alignment of three bright stars forming a hunter's belt?
8. ID: science-light-speed | text; medium | Answer: Light | Accepted: light, speed of light | Question: In physics, the constant 'c' represents the maximum speed of what entity traveling through a perfect vacuum?
9. ID: science-chemistry-water | text; easy | Answer: Water | Accepted: water, h2o, dihydrogen monoxide | Question: What common chemical compound is composed of two hydrogen atoms bonded to a single oxygen atom?
10. ID: science-biology-photosynthesis | text; hard | Answer: Chlorophyll | Accepted: chlorophyll, chlorophyll a, chlorophyll b | Question: What is the chemical name of the green pigment found in plants that absorbs light energy to drive photosynthesis?
11. ID: science-newton-cradle | image; easy | Answer: Newton's Cradle | Accepted: newton's cradle, newtons cradle, colliding balls | Question: Consisting of a series of swinging metal spheres, what specific physics device demonstrates the conservation of momentum and energy?
12. ID: science-venus-planet | image; easy | Answer: Venus | Accepted: venus | Question: Due to a dense, runaway greenhouse gas atmosphere that traps intense heat, which second planet from the Sun holds the distinction of being the hottest in our solar system?
13. ID: science-geyser-hydrogeology | image; easy | Answer: Geyser | Accepted: geyser, geysers | Question: Characterized by an intermittent, turbulent eruption of boiling water and steam from the ground, what type of rare geothermal feature is pictured here?
14. ID: science-ozone-layer | image; easy | Answer: Ozone Layer | Accepted: ozone layer, ozone, ozonosphere | Question: Located primarily within the lower portion of Earth's stratosphere, what specific chemical layer shields life by absorbing most of the Sun's harmful ultraviolet radiation?
15. ID: science-seismograph-earthquake | image; easy | Answer: Seismograph | Accepted: seismograph, seismometer | Question: What scientific instrument is utilized by geologists to detect, measure, and record the intensity of ground motion produced by earthquakes or volcanic activity?
16. ID: science-lichen-symbiosis | image; medium | Answer: Lichen | Accepted: lichen, lichens | Question: Often found growing on rocks or tree trunks, what complex organism is actually a highly integrated symbiotic partnership between a fungus and an alga?
17. ID: science-pangaea-supercontinent | image; medium | Answer: Pangaea | Accepted: pangaea, pangea | Question: Formed during the late Paleozoic era, what is the specific name of the ancient geological supercontinent that once assembled almost all of Earth's current landmasses together?
18. ID: science-coriolis-effect | image; medium | Answer: Coriolis Effect | Accepted: coriolis effect, coriolis force | Question: What physics and meteorological phenomenon causes fluids like global winds and ocean currents to curve as they travel across Earth's surface due to the planet's rotation?
19. ID: science-mutualism-interaction | image; medium | Answer: Mutualism | Accepted: mutualism, mutualistic relationship | Question: What specific biological term describes an ecological interaction between two distinct species in which both organisms actively receive a net benefit?
20. ID: science-event-horizon | image; hard | Answer: Event Horizon | Accepted: event horizon, point of no return | Question: In general relativity, what specific name is given to the theoretical threshold surrounding a black hole past which the escape velocity exceeds the speed of light?

### Mythology

1. ID: mythology-greek-zeus | image; easy | Answer: Zeus | Accepted: zeus | Question: Who is this supreme ruler of Mount Olympus and Greek god of the sky, weather, and thunderbolts?
2. ID: mythology-egypt-anubis | image; medium | Answer: Anubis | Accepted: anubis | Question: What is the name of this ancient Egyptian god of mummification and the afterlife, traditionally depicted with the head of a jackal?
3. ID: mythology-norse-thor | text; easy | Answer: Mjolnir | Accepted: mjolnir, mjölnir | Question: In Norse mythology, what is the name of Thor's magical, short-handled war hammer capable of channeling lightning?
4. ID: mythology-greek-medusa | image; easy | Answer: Medusa | Accepted: medusa | Question: What is the name of the monstrous Gorgon sister from Greek myth who features venomous snakes in place of hair?
5. ID: mythology-norse-valhalla | text; medium | Answer: Valhalla | Accepted: valhalla | Question: In Norse mythology, what is the name of Odin's majestic, gold-bright hall in Asgard where half of those who die in combat are led?
6. ID: mythology-greek-achilles | text; medium | Answer: Achilles | Accepted: achilles | Question: Which hero of the Trojan War was invulnerable in all of his body except for his heel, which ultimately led to his downfall?
7. ID: mythology-greek-pegasus | image; medium | Answer: Pegasus | Accepted: pegasus | Question: What is the name of the famous mythical winged stallion born from the blood of the slain Gorgon Medusa?
8. ID: mythology-norse-yggdrasil | image; medium | Answer: Yggdrasil | Accepted: yggdrasil, yggdrasill | Question: What is the name of the immense, sacred ash tree that connects the nine worlds of Norse cosmology?
9. ID: mythology-greek-cerberus | text; medium | Answer: Cerberus | Accepted: cerberus, kerberos | Question: What is the name of the multi-headed hound that guards the gates of the Greek Underworld to prevent the dead from leaving?
10. ID: mythology-rome-romulus | text; hard | Answer: Romulus | Accepted: romulus | Question: According to the foundation myth of Rome, which twin brother killed Remus and went on to become the very first king of the city?
11. ID: mythology-anubis-jackal | image; easy | Answer: Jackal | Accepted: jackal, egyptian jackal, dog, canine | Question: Associated with mummification and the afterlife in ancient Egyptian mythology, what canine animal's head represents the god Anubis?
12. ID: mythology-icarus-wings | image; easy | Answer: Icarus | Accepted: icarus | Question: In Greek legend, who plummeted into the sea after ignoring his father Daedalus's warnings and flying too close to the sun with wings made of feathers and wax?
13. ID: mythology-ra-sun | image; easy | Answer: The Sun | Accepted: sun, the sun | Question: As the supreme king of the gods in ancient Egyptian mythology, what astronomical celestial body does the falcon-headed deity Ra represent and rule over?
14. ID: mythology-zeus-thunderbolt | image; easy | Answer: Thunderbolt | Accepted: thunderbolt, lightning, lightning bolt, thunderbolts | Question: Gifted to him by the Cyclopes during the Titanomachy, what signature weapon does the Greek sky god Zeus hurl from Mount Olympus?
15. ID: mythology-cerberus-heads | text; easy | Answer: 3 | Accepted: 3, three | Question: In Greek mythology, the monstrous hound Cerberus guards the gates of the Underworld to prevent the dead from leaving. How many heads does he traditionally have?
16. ID: mythology-valhalla-odin | image; medium | Answer: Valhalla | Accepted: valhalla, valhöll | Question: In Norse mythology, half of those who die a heroic death in battle are chosen by Valkyries to go to Fólkvangr, while the other half are brought to which majestic, golden-roofed hall ruled by Odin?
17. ID: mythology-minotaur-labyrinth | image; medium | Answer: The Labyrinth | Accepted: labyrinth, the labyrinth, maze, cretan labyrinth | Question: Born to Pasiphaë and eventually slain by Theseus, the monstrous bull-headed Minotaur was trapped inside what elaborate, confusing maze structure?
18. ID: mythology-fenrir-wolf | text; medium | Answer: Wolf | Accepted: wolf, monstrous wolf, giant wolf | Question: Fathered by Loki and destined to fatally swallow Odin during the cataclysmic events of Ragnarok, what type of massive animal is Fenrir?
19. ID: mythology-achilles-heel | text; medium | Answer: Heel | Accepted: heel, achilles tendon, foot | Question: According to epic accounts of the Trojan War, Paris managed to assassinate the near-invincible hero Achilles by shooting an arrow into which exact part of his body?
20. ID: mythology-ouroboros-snake | image; hard | Answer: Ouroboros | Accepted: ouroboros, uroboros | Question: Representing the eternal cycle of life, death, and rebirth across multiple ancient civilizations, what name is given to the symbol of a serpent or dragon eating its own tail?

### Art and Music

1. ID: artmusic-vincent-sunflowers | image; easy | Answer: Vincent | Accepted: vincent, vincent van gogh | Question: What is the first name of the famous Dutch Post-Impressionist painter who created this iconic 1888 masterpiece titled 'Sunflowers'?
2. ID: artmusic-violin-strings | text; easy | Answer: 4 | Accepted: 4, four | Question: Played with a horsehair bow, a standard modern violin is equipped with exactly how many individual strings?
3. ID: artmusic-monalisa-louvre | image; easy | Answer: Louvre | Accepted: louvre, the louvre, louvre museum, musée du louvre | Question: Leonardo da Vinci's legendary 16th-century painting, the Mona Lisa, is permanently on display in which famous art museum in Paris?
4. ID: artmusic-instruments-woodwind | image; easy | Answer: Woodwind | Accepted: woodwind, woodwinds, the woodwind family | Question: In a classical symphony orchestra, instruments like the flute, clarinet, oboe, and bassoon collectively belong to which specific instrument family?
5. ID: artmusic-ukulele-hawaii | image; easy | Answer: Ukulele | Accepted: ukulele, ukalele, uke | Question: Adapted from Portuguese stringed instruments, what is the name of this small, four-stringed, guitar-like instrument closely associated with Hawaiian music?
6. ID: artmusic-scream-munch | image; medium | Answer: Edvard Munch | Accepted: edvard munch, munch | Question: Which Norwegian Expressionist artist painted this agonizing, iconic 1893 masterpiece titled 'The Scream'?
7. ID: artmusic-piano-forte | text; medium | Answer: Loud | Accepted: loud, strongly | Question: Invented by Bartolomeo Cristofori, the word 'piano' is actually a shortened form of its original Italian name, 'pianoforte'. What does 'forte' translate to in English musical dynamics?
8. ID: artmusic-sculpture-thinker | image; medium | Answer: The Thinker | Accepted: the thinker, thinker, le penseur | Question: Sculpted by Auguste Rodin, what is the official title of this bronze figure depicted resting his chin on his hand in deep contemplation?
9. ID: artmusic-opera-soprano | image; medium | Answer: Soprano | Accepted: soprano, coloratura soprano, lyric soprano | Question: In classical opera and choral music, what specific Italian term is used to describe the highest singing voice type attainable by an adult female?
10. ID: artmusic-beethoven-deaf | text; hard | Answer: 9 | Accepted: 9, nine, ninth, 9th, symphony no 9, symphony no. 9 | Question: Despite being completely deaf by the time he finalized it in 1824, which number symphony did Ludwig van Beethoven compose that features the famous choral 'Ode to Joy'?
11. ID: artmusic-michelangelo-david | image; easy | Answer: David | Accepted: david, statue of david | Question: Sculpted out of a single block of white Carrara marble between 1501 and 1504, what is the name of Michelangelo's legendary Renaissance masterpiece depicting a biblical hero?
12. ID: artmusic-guitar-strings | text; easy | Answer: 6 | Accepted: 6, six | Question: A standard, universally common acoustic or classical guitar is built to be restrung with exactly how many total strings?
13. ID: artmusic-monet-waterlilies | image; easy | Answer: Claude Monet | Accepted: claude monet, monet, claude | Question: Fascinated by the reflections in his personal garden pond at Giverny, which French Impressionist painter spent his final decades creating a series of approximately 250 oil paintings titled 'Water Lilies'?
14. ID: artmusic-piano-keys | image; easy | Answer: 88 | Accepted: 88, eighty eight, eighty-eight | Question: Spanning exactly seven full octaves plus a few minor extra notes, a standard modern full-sized acoustic piano features how many total keys across its keyboard layout?
15. ID: artmusic-starry-night-van-gogh | image; easy | Answer: Vincent van Gogh | Accepted: vincent van gogh, van gogh, vincent | Question: Painted from his asylum room window in Saint-Rémy-de-Provence, the iconic 1889 post-impressionist artwork 'The Starry Night' was created by which legendary Dutch artist?
16. ID: artmusic-gothic-architecture-notredame | image; medium | Answer: Gothic | Accepted: gothic, gothic architecture, french gothic | Question: Characterized by pointed arches, ribbed vaults, and flying buttresses, what specific architectural design style is epitomized by the Notre-Dame Cathedral in Paris?
17. ID: artmusic-mozart-child-prodigy | image; medium | Answer: Wolfgang Amadeus Mozart | Accepted: wolfgang amadeus mozart, mozart, wolfgang mozart | Question: Born in Salzburg in 1756, what legendary classical era composer was a famous child prodigy, writing his very first symphonies and concertos by the time he was just eight years old?
18. ID: artmusic-instrument-marimba | image; medium | Answer: Marimba | Accepted: marimba, xylophone | Question: Striking resonant wooden bars over metallic tubes using soft yarn mallets, what traditional percussion instrument family member is shown here?
19. ID: artmusic-vocal-tenor | image; medium | Answer: Tenor | Accepted: tenor | Question: In classical choral arrangement and operatic performance, what specific Italian term denotes the highest natural singing voice type achievable by an adult male?
20. ID: artmusic-dali-persistence-clocks | image; hard | Answer: Clocks | Accepted: clocks, watches, pocket watches, clock, watch | Question: What common everyday items are famously depicted as drooping, warping, and melting away across a desert landscape in Salvador Dalí's surrealist 1931 painting 'The Persistence of Memory'?
