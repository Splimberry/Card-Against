(() => {
  const storageKey = "cardsAgainstAiUiLanguage";
  const defaultLanguage = "en";
  const supportedLanguages = {
    en: { label: "English", htmlLang: "en" },
    "zh-Hant": { label: "繁體中文", htmlLang: "zh-Hant" }
  };

  const zhHant = {
    "Trivia Against AI - Play Multiplayer AI Trivia": "Trivia Against AI - 多人 AI 問答派對遊戲",
    "Play Trivia Against AI, a multiplayer AI trivia web game with public rooms, power-ups, achievements, cosmetics, and user-created questions.": "遊玩 Trivia Against AI：支援公開房間、能力卡、成就、外觀和玩家自製題目的多人 AI 問答遊戲。",
    "Challenge friends in public trivia rooms with AI judging, power-ups, achievements, cosmetics, and user-created questions.": "在公開問答房間挑戰朋友，享受 AI 評分、能力卡、成就、外觀和玩家自製題目。",
    "Game help": "遊戲說明",
    "App version": "應用程式版本",
    "Choose mode": "選擇模式",
    "Player profile": "玩家檔案",
    "You": "你",
    "Sign in": "登入",
    "Sign out": "登出",
    "Customize Card": "自訂卡牌",
    "Currency balance": "金幣餘額",
    "Coins": "金幣",
    "Shop": "商店",
    "Loading profile": "正在載入檔案",
    "Checking your account...": "正在檢查你的帳戶...",
    "Settings": "設定",
    "Sound On": "音效開啟",
    "Sound Off": "音效關閉",
    "View Abilities & Events": "查看能力與事件",
    "Achievements": "成就",
    "Create Questions": "建立題目",
    "Admin Login": "管理員登入",
    "Dev Tool": "開發工具",
    "Solo vs Bots": "單人對戰機器人",
    "Local 1v1": "本地 1v1",
    "Quick Start": "快速開始",
    "5 rounds, 30s timer, 2 bots, all themes, power-ups on.": "5 回合、30 秒、2 個機器人、所有主題、能力卡開啟。",
    "5 rounds, 30s timer, all themes, power-ups on.": "5 回合、30 秒、所有主題、能力卡開啟。",
    "Solo vs Bots settings": "單人對戰機器人設定",
    "Local 1v1 settings": "本地 1v1 設定",
    "Online Room": "線上房間",
    "Create": "建立",
    "Configure a multiplayer room and open the lobby chat.": "設定多人房間並開啟大廳聊天。",
    "Join Game": "加入遊戲",
    "Rooms": "房間",
    "Browse hosted public and private rooms.": "瀏覽公開與私人房間。",
    "Multiplayer setup": "多人設定",
    "CREATE ROOM": "建立房間",
    "Game Settings": "遊戲設定",
    "Rounds": "回合",
    "Timer": "計時",
    "Players": "玩家",
    "Select Themes": "選擇主題",
    "All trivia themes enabled.": "已啟用所有問答主題。",
    "Room privacy": "房間私隱",
    "Auto Advance": "自動前進",
    "Automatically move on after 30 seconds during grading.": "評分階段 30 秒後自動進入下一步。",
    "Private Room": "私人房間",
    "Require a password before joining.": "加入前需要輸入密碼。",
    "Password": "密碼",
    "Room password": "房間密碼",
    "Modifiers": "玩法加成",
    "Game mode variants": "遊戲玩法加成",
    "Amplified": "倍率增幅",
    "Points earned this round are multiplied by a random amplifier at the end.": "本回合獲得的分數會在結算時乘上隨機倍率。",
    "Brutal": "殘酷",
    "Getting a question wrong costs you 10% of your points.": "答錯會扣除你 10% 分數。",
    "Chaos": "混沌",
    "Power-ups refill and reroll every round.": "每回合會補充並重抽能力卡。",
    "Time Is Money": "時間就是金錢",
    "The faster you answer, the more points you earn.": "答得越快，獲得分數越多。",
    "Wild Fire": "野火",
    "Wrong answers will not break your streak, and high streaks can make others lose points.": "答錯不會中斷連勝，高連勝還能讓其他人扣分。",
    "Party Mayhem": "派對混亂",
    "Drastically increases the chance of table events appearing.": "大幅提高場上事件出現機率。",
    "Random": "隨機",
    "Checked modifiers are guaranteed; unchecked modifiers can still roll in.": "已勾選的玩法必定出現；未勾選的仍有機會被隨機抽中。",
    "Classic": "經典",
    "Multiplayer only. Disables modifiers, table events, and power-ups.": "僅多人模式。停用玩法加成、場上事件和能力卡。",
    "Disables modifiers, table events, and power-ups.": "停用玩法加成、場上事件和能力卡。",
    "Create Room": "建立房間",
    "Room code": "房間代碼",
    "Copy Invite Link": "複製邀請連結",
    "Creating as": "建立身分",
    "Room host profile": "房主檔案",
    "Room players": "房間玩家",
    "Hosted rooms": "已開房間",
    "JOIN GAME": "加入遊戲",
    "JOIN ROOM": "加入房間",
    "Refresh": "重新整理",
    "Back": "返回",
    "Password if private": "私人房間密碼",
    "Join Code": "用代碼加入",
    "Join Room": "加入房間",
    "Hosted game rooms": "可加入房間",
    "Waiting room": "等待室",
    "ROOM LOBBY": "房間大廳",
    "Leave": "離開",
    "Host": "房主",
    "Add Bot": "加入機器人",
    "Begin Match": "開始對戰",
    "Lobby players": "大廳玩家",
    "Lobby chat": "大廳聊天",
    "Room chat": "房間聊天",
    "Classic Match": "經典對戰",
    "Chat message": "聊天訊息",
    "Lobby chat": "大廳聊天",
    "Send": "傳送",
    "Trivia Against AI game table": "Trivia Against AI 遊戲桌",
    "Five-round match": "五回合對戰",
    "Leave Game": "離開遊戲",
    "End Game": "結束遊戲",
    "Scoreboard": "排行榜",
    "Player leaderboard": "玩家排行榜",
    "Match status": "對戰狀態",
    "Round": "回合",
    "Spectators watching this match.": "正在觀看這場對戰的旁觀者。",
    "Round help": "回合說明",
    "Trivia grader": "問答評分員",
    "Grading focus": "評分重點",
    "Trivia Question": "問答題目",
    "Mixed Trivia": "混合問答",
    "Medium +500": "中等 +500",
    "Waiting for image...": "等待圖片...",
    "Power ups": "能力卡",
    "Power Debug": "能力除錯",
    "Active effects": "生效效果",
    "Your answer": "你的答案",
    "Answer the trivia question.": "回答這道問答題。",
    "Player 1 phrase": "玩家 1 答案",
    "Player 1 answer": "玩家 1 答案",
    "Player 2 phrase": "玩家 2 答案",
    "Player 2 answer": "玩家 2 答案",
    "Multiple choice answers": "選擇題答案",
    "Submit": "提交",
    "Lock In": "鎖定",
    "Question progress": "題目進度",
    "Question Progress": "題目進度",
    "0/10 answered": "0/10 已回答",
    "Submitted trivia answers": "已提交答案",
    "Bot 1": "機器人 1",
    "Bot 2": "機器人 2",
    "Cycle unseen answers": "切換未顯示答案",
    "More answers": "更多答案",
    "Answer review": "答案評分",
    "Power Effects": "能力效果",
    "Power up results": "能力結算",
    "Round point recap": "回合分數總結",
    "Next Round": "下一回合",
    "AI generation failed": "AI 生成失敗",
    "Could not generate this round.": "無法生成本回合。",
    "Try Again": "再試一次",
    "Checking the answers...": "正在檢查答案...",
    "Match complete": "對戰完成",
    "Final leaderboard": "最終排行榜",
    "View Timeline": "查看時間線",
    "Hide Timeline": "隱藏時間線",
    "Rematch": "再戰一局",
    "Continue Playing": "繼續遊玩",
    "Spectate": "旁觀",
    "Change Mode": "切換模式",
    "Back to Room": "返回房間",
    "Match timeline": "對戰時間線",
    "Talk trash responsibly": "理性聊天",
    "Close": "關閉",
    "Audio & Performance": "音效與效能",
    "SFX Volume": "音效音量",
    "Music Volume": "音樂音量",
    "Performance": "效能",
    "Full effects": "完整特效",
    "Balanced": "平衡",
    "Low power": "省電",
    "Minimal": "最低特效",
    "Full": "完整",
    "Low": "省電",
    "Language": "語言",
    "English": "英文",
    "Power Suggestions": "能力建議",
    "On": "開",
    "Off": "關",
    "Power-ups and table events": "能力卡與場上事件",
    "Abilities & Events": "能力與事件",
    "Chaos preview": "混沌預覽",
    "Account record": "帳戶紀錄",
    "Quick guide": "快速指南",
    "Game Basics": "遊戲基礎",
    "Round flow": "回合流程",
    "A question appears, everyone answers before the timer ends, then answers are graded and points resolve.": "題目出現後，所有人在倒數結束前作答，之後進入評分與結算。",
    "Answer rules": "答案規則",
    "Aliases and minor typos can count if the intended answer is clear.": "如果意思明確，別名和小拼寫錯誤也有機會算對。",
    "Power-ups": "能力卡",
    "You can use them during answering phase, they will refill 1 slot when you have 3x or more streaks or when you lose.": "你可以在作答階段使用。連勝達 3x 或落敗時會補充 1 個空位。",
    "Scoring": "得分",
    "You will gain a small bonus for getting as accurate as possible. Difficulty, streaks, and active modifiers can boost your point earned.": "答案越準確會有額外獎勵。難度、連勝和玩法加成都會影響得分。",
    "Table events": "場上事件",
    "Some rounds add global rules adding a fun twist to the round.": "部分回合會加入全場規則，讓局面更有變化。",
    "Achievement can only be earned/progressed in public 10-round matches, bot rounds and local 1v1 will not contribute to unlocking achievements.": "成就只會在公開 10 回合多人對戰中取得或推進；機器人和本地 1v1 不會計入。",
    "Card cosmetic": "卡牌外觀",
    "Theme": "主題",
    "Gradient colours": "漸層顏色",
    "Top colour": "上方顏色",
    "Bottom colour": "下方顏色",
    "Styles · Effects": "樣式 · 特效",
    "Styles · Pattern": "樣式 · 圖案",
    "Font": "字體",
    "Title prefix": "稱號前綴",
    "Prefix colour": "前綴顏色",
    "RGB": "RGB",
    "Pastel": "柔色",
    "Preview": "預覽",
    "Exact Answer +250": "精準答案 +250",
    "Look at my pretty card :3": "看看我的漂亮卡牌 :3",
    "Username": "使用者名稱",
    "Your username": "你的使用者名稱",
    "Upload profile picture": "上傳頭像",
    "Sign in to edit your username, upload a profile picture, and save card customizations.": "登入後可編輯名稱、上傳頭像並儲存卡牌外觀。",
    "Choose a card look, then save.": "選擇卡牌外觀後儲存。",
    "Undo": "復原",
    "Redo": "重做",
    "Reset": "重設",
    "Exit": "離開",
    "Save": "儲存",
    "Player account": "玩家帳戶",
    "Keep your profile synced": "同步你的檔案",
    "Save coins, achievements, cosmetics, submitted questions, and card styles across devices.": "跨裝置保存金幣、成就、外觀、提交題目和卡牌樣式。",
    "Continue with Google": "使用 Google 繼續",
    "or use email": "或使用電郵",
    "Email": "電郵",
    "Password": "密碼",
    "At least 6 characters": "至少 6 個字元",
    "Show password": "顯示密碼",
    "Hide password": "隱藏密碼",
    "Create account": "建立帳戶",
    "Choose a sign-in method to load your saved profile.": "選擇登入方式以載入已儲存檔案。",
    "Profile cosmetics": "檔案外觀",
    "Coins available": "可用金幣",
    "Rotating stock": "輪換商品",
    "Refreshes soon": "即將刷新",
    "Three cosmetics are available at a time. Purchases stay owned forever.": "每次會顯示三件外觀。購買後永久擁有。",
    "Admin testing": "管理員測試",
    "Timer runs until you use this panel.": "使用此面板前計時器會繼續運行。",
    "Owner": "持有者",
    "Search": "搜尋",
    "Find power-up": "搜尋能力卡",
    "Power-up": "能力卡",
    "Chaos version": "混沌版本",
    "Pause timer": "暫停計時",
    "Unlimited powers": "無限能力卡",
    "Give Power": "給予能力卡",
    "Fill Hand": "補滿手牌",
    "Clear Hand": "清空手牌",
    "Give yourself or a bot any power-up. Bots use forced power-ups immediately.": "給自己或機器人任意能力卡。機器人會立即使用被指定的能力卡。",
    "Trivia pool": "問答題庫",
    "Enable All": "全部啟用",
    "Advanced Settings": "進階設定",
    "Bot Settings": "機器人設定",
    "Local Settings": "本地設定",
    "Restore these quick-start settings.": "還原快速開始設定。",
    "Bots": "機器人",
    "End game": "結束遊戲",
    "Leave this match?": "要離開這場對戰嗎？",
    "Leave this room?": "要離開這個房間嗎？",
    "Leave game": "離開遊戲",
    "Leave room": "離開房間",
    "Your current match will end immediately and show the results screen.": "目前對戰會立即結束並顯示結果畫面。",
    "Cancel": "取消",
    "Choose target": "選擇目標",
    "Pick a player": "選擇一位玩家",
    "Try this": "試試這招",
    "Your power-ups": "你的能力卡",
    "Pick one before locking in.": "鎖定答案前可以先選一張。",
    "No power-ups left.": "沒有能力卡了。",
    "Disabled in Classic.": "經典模式已停用。",
    "Power Outage this round.": "本回合能力停電。",
    "Black Market: unlimited use.": "黑市：不限使用次數。",
    "Chaos Infused": "混沌灌注",
    "Common": "普通",
    "Rare": "稀有",
    "Epic": "史詩",
    "Legendary": "傳奇",
    "Doom": "末日",
    "None": "沒有",
    "Score changes": "分數變化",
    "No power": "沒有能力卡",
    "Active effects": "生效效果",
    "Title unlocked": "稱號已解鎖",
    "Secret": "秘密",
    "Locked": "未解鎖",
    "Unlocked": "已解鎖",
    "Equipped": "已裝備",
    "Equip": "裝備",
    "Equipped title": "目前稱號",
    "Clear Title": "清除稱號",
    "Reward road": "獎勵路線",
    "Achievement Milestones": "成就里程碑",
    "Claimed": "已領取",
    "Claim": "領取",
    "Current rotation": "目前輪換",
    "No title": "沒有稱號",
    "Name preview": "名稱預覽",
    "No Modifiers": "無玩法加成",
    "Private": "私人",
    "Public": "公開",
    "Waiting for more players to join.": "正在等待更多玩家加入。",
    "Waiting for the host to deal the round...": "等待房主發出本回合題目...",
    "Waiting for the host to sync the answer review...": "等待房主同步答案評分...",
    "Waiting for bots...": "等待機器人...",
    "Spectator mode: you can chat and watch the table, but you will join play next match.": "旁觀模式：你可以聊天和觀看對局，下一場才會加入遊玩。",
    "Submitted": "已提交",
    "Submitted blank": "已提交空白答案",
    "Typing...": "正在輸入...",
    "Skip to Grading": "跳到評分",
    "Choose the correct answer.": "選擇正確答案。",
    "Answer the trivia question.": "回答這道問答題。",
    "Image not retrieved": "未能取得圖片",
    "Image failed to load.": "圖片載入失敗。",
    "Waiting for image...": "等待圖片...",
    "Text-only question.": "純文字題目。",
    "Image preview": "圖片預覽",
    "Image URL preview": "圖片 URL 預覽",
    "Loading image...": "正在載入圖片...",
    "Question preview": "題目預覽",
    "Accepted answers appear here.": "接受答案會顯示在這裡。",
    "Rejected answers appear here.": "拒絕答案會顯示在這裡。",
    "AI grading disabled. Exact option match only.": "AI 評分已停用。只接受完全相同的選項。",
    "Select a question.": "選擇一道題目。",
    "Select a question first": "請先選擇題目",
    "Type an answer exactly like a player would": "像玩家作答一樣輸入答案",
    "Type an answer first.": "請先輸入答案。",
    "AI Review Allowed": "允許 AI 覆核",
    "AI Review Blocked": "已阻止 AI 覆核",
    "Raw shield result": "原始防護結果",
    "Raw result": "原始結果",
    "This would only call AI after the provider key is configured.": "只有在 AI 供應商金鑰設定好後才會呼叫 AI。",
    "Mixed grading will also rely on local marking until the AI token/provider configuration is fixed.": "在 AI token/供應商設定修好前，混合評分仍會依賴本地評分。",
    "Checking AI shield...": "正在檢查 AI 防護...",
    "Could not check the AI shield.": "無法檢查 AI 防護。",
    "Ready. Created questions are saved to the persistent question bank.": "準備好了。建立的題目會儲存到持久題庫。",
    "Question": "題目",
    "Answer": "答案",
    "Accepted answers": "接受答案",
    "Incorrect answers": "錯誤答案",
    "Rejected answers": "拒絕答案",
    "Image URL": "圖片 URL",
    "Alt text": "替代文字",
    "Credit": "來源",
    "Question text": "題目文字",
    "Main answer": "主要答案",
    "first, second, third": "第一個、第二個、第三個",
    "wrong one, wrong two, wrong three": "錯誤一、錯誤二、錯誤三",
    "wrong one, wrong two": "錯誤一、錯誤二",
    "bad answer, too vague": "錯誤答案、太模糊",
    "Short image description": "簡短圖片描述",
    "Wikimedia Commons": "Wikimedia Commons",
    "Save Question": "儲存題目",
    "Create Question": "建立題目",
    "Save as New": "另存新題",
    "View": "查看",
    "Winner": "勝出",
    "Watching": "旁觀中",
    "No score": "沒有分數",
    "Bot player": "機器人玩家",
    "Room host": "房主",
    "Spectator": "旁觀者",
    "Click to kick this bot from the room.": "點擊將此機器人踢出房間。",
    "Kicking": "正在踢出",
    "Kick": "踢出",
    "Muting": "正在靜音",
    "Unmuting": "正在解除靜音",
    "Mute": "靜音",
    "Unmute": "解除靜音",
    "Banning": "正在封鎖",
    "Ban": "封鎖",
    "Vote ban": "投票封鎖",
    "BANNING": "封鎖中",
    "KICKING": "踢出中",
    "MUTING": "靜音中",
    "UNMUTING": "解除靜音中",
    "BOT": "機器人",
    "HOST": "房主",
    "MUTED": "已靜音",
    "PLAYER": "玩家",
    "Copied": "已複製",
    "Continue": "繼續",
    "Refreshing...": "正在重新整理...",
    "Joining...": "正在加入...",
    "Rejoin": "重新加入",
    "No hosted rooms yet.": "暫時沒有已開房間。",
    "Room server is not connected.": "房間伺服器尚未連線。",
    "Create one first": "先建立一個房間",
    "Open the app from npm start on the same address": "請用相同地址從 npm start 開啟應用程式",
    "Current rotation": "目前輪換",
    "Always unlocked.": "永遠可用。",
    "No progress counter": "沒有進度計數",
    "Set Progress": "設定進度",
    "Enable": "啟用",
    "Disable": "停用",
    "Special player badge": "特殊玩家徽章",
    "Profile customization debug reset.": "檔案外觀除錯已重設。",
    "All profile customizations enabled.": "已啟用所有檔案外觀。",
    "All profile customizations disabled.": "已停用所有檔案外觀。",
    "Close admin login": "關閉管理員登入",
    "Paste ADMIN_TOKEN": "貼上 ADMIN_TOKEN",
    "Use the private ADMIN_TOKEN from Vercel. This unlocks local browser access only for this session.": "使用 Vercel 的私人 ADMIN_TOKEN。只會解鎖本次瀏覽器工作階段的本地存取。",
    "Paste your ADMIN_TOKEN first.": "請先貼上 ADMIN_TOKEN。",
    "Checking admin access...": "正在檢查管理員權限...",
    "Admin login failed.": "管理員登入失敗。",
    "Loading question bank...": "正在載入題庫...",
    "Could not load question bank.": "無法載入題庫。",
    "No questions match these filters.": "沒有題目符合篩選條件。",
    "All themes": "所有主題",
    "All image URLs loaded through the proxy.": "所有圖片 URL 都已透過代理載入。",
    "No image questions found.": "找不到圖片題。",
    "No obvious duplicate questions, answers, or image URLs found.": "沒有發現明顯重複的題目、答案或圖片 URL。",
    "Most repeated": "最多重複",
    "Least seen": "最少出現",
    "Victory animation": "勝利動畫",
    "Preview uses your current profile style for the winner row.": "預覽會使用你目前的檔案樣式顯示勝者列。",
    "No completed rounds to show yet.": "暫時沒有已完成回合可顯示。",
    "No winning answer.": "沒有勝出答案。",
    "No winner": "沒有勝者",
    "Result": "結果",
    "medium": "中等",
    "Hide Timeline": "隱藏時間線",
    "View Timeline": "查看時間線",
    "Final scores": "最終分數",
    "Match ended early.": "對戰提早結束。",
    "AI reviewed": "AI 已覆核",
    "AI took a second look": "AI 再看了一次",
    "Correct": "正確",
    "Incorrect": "錯誤",
    "Exact Answer": "精準答案",
    "Close Enough": "接近答案",
    "Missed": "答錯",
    "Speed Demon": "速度魔人",
    "Quick Reaction": "快速反應",
    "Fast Enough": "夠快",
    "Room invite": "房間邀請",
    "Room invite link copied.": "已複製房間邀請連結。",
    "Could not copy invite link.": "無法複製邀請連結。",
    "Copied invite link.": "已複製邀請連結。",
    "Create one first.": "請先建立一個房間。",
    "Checking with mixed grading...": "正在使用混合評分檢查...",
    "Checking with force ai grading...": "正在使用強制 AI 評分檢查...",
    "Checking with non ai grading...": "正在使用非 AI 評分檢查...",

    "If you think you'll win, cash in harder.": "如果你覺得會贏，就把獎勵放大。",
    "Confidence pays bigger in chaos.": "混沌中，自信會換來更大回報。",
    "A solid bonus when you trust your answer.": "相信自己答案時，這是穩定加分。",
    "Strong answer? Make the win heavier.": "答案很穩？讓勝利更值錢。",
    "This is best when your score is already worth multiplying.": "分數已經很高時，倍率最有價值。",
    "Feeling confident? Double the reward, accept the bite.": "有信心？加倍獎勵，也承擔風險。",
    "Huge upside, huge punishment. Use only if you believe.": "上限很高，懲罰也重。只有夠信才用。",
    "Your streak is valuable. Keep it alive.": "你的連勝很值錢，保住它。",
    "Link to a stronger streak and ride their momentum.": "連上更強的連勝，借他們的勢。",
    "Someone has streak to steal. Take their rhythm.": "有人有連勝可偷，拿走節奏。",
    "Everyone else has streak value. Pull it all toward you.": "其他人的連勝都有價值，把它們拉到你身上。",
    "Tag the likely winner before they cash out.": "在可能勝出的人結算前標記他。",
    "A winner is about to get paid. Infect that payout.": "有人快要拿分了，感染他的獎勵。",
    "Slow down someone who looks ready to win this round.": "拖慢看起來要贏這回合的人。",
    "Stop their payout and freeze their momentum.": "截停他的得分，凍住他的節奏。",
    "Someone is about to score big. Take a slice.": "有人快拿大分了，分一杯羹。",
    "The biggest payout can become yours too.": "最大一筆得分也可以變成你的。",
    "Nobody deserves points this round.": "這回合誰都別想拿分。",
    "Blanking out? Let the machine take a swing.": "腦袋空白？讓機器幫你試一下。",
    "This is your panic button. Very good when your answer box is empty.": "這是你的緊急按鈕。答案欄空白時特別好用。",
    "Answer fast, then get paid for the time left.": "快點答，剩下的時間換成分數。",
    "Reset the clock and turn speed into money.": "重置時間，把速度變成分數。",
    "Set up a theme you actually want next.": "安排下一題變成你想要的主題。",
    "Buy a better option if your hand feels weak.": "手牌太弱就買一張更好的。",
    "Shop for something dangerous.": "買一張更危險的東西。",
    "Stop their streak from growing while you catch up.": "阻止他的連勝增長，趁機追上。",
    "Freeze them and shave off their momentum.": "凍住他，削走他的氣勢。",
    "Someone has useful cards. Steal one.": "有人有好用的卡，偷一張。",
    "Take their best card, not just any card.": "拿走他最好的卡，不只是隨機一張。",
    "You have multiple plays. Use them all.": "你可以連續出招，把它們全用上。",
    "Last place, last round. This is your comeback script.": "最後一名、最後一回合。這就是逆轉劇本。",
    "You are down to the final throw. Make it dramatic.": "最後一搏了，讓它夠戲劇性。",
    "If this round goes badly, at least get paid.": "就算這回合失手，也至少有補償。",
    "Free safety net. Great before a risky round.": "免費安全網。高風險回合前很好用。",
    "Protect your score, streak, and refill plan.": "保護分數、連勝和補牌節奏。",
    "Lose safely, refill, and keep moving.": "安全地輸，補牌後繼續前進。",
    "First place is looking too comfortable.": "第一名看起來太舒服了。",
    "The leader has enough. Take your share.": "領先者已經夠多了，拿你那份。",
    "Tax the top before the gap gets ugly.": "差距變難看前，先向榜首收稅。",
    "Let someone else do the work, then take the payout.": "讓別人努力，然後拿走收益。",
    "The clock is becoming a problem. Bend it before it bends you.": "時間開始不妙了，先扭轉它。",
    "Sometimes skill is optional.": "有時技術不是必需品。",
    "Force the result when this round matters too much.": "這回合太重要時，直接強行改結果。",
    "Bad hand? Throw it away.": "手牌不好？丟掉重抽。",
    "Refresh and refill in one clean move.": "一次過刷新並補滿。",
    "First place should start paying rent.": "第一名該開始交租了。",
    "You need damage, and you need it now.": "你需要傷害，而且現在就要。",
    "Choose one player and delete a serious chunk.": "選一個人，直接削掉一大截。",
    "Take clean points now.": "現在先拿穩定分。",
    "Start a long-term point engine.": "啟動長期得分引擎。",
    "Big reward if you win, painful curse if you miss.": "贏了大賺，失手會很痛。",
    "You are worth protecting.": "你值得被保護。",
    "Keep this up when attacks are likely.": "覺得快被打時，先開防護。",
    "Point loss is coming. Turn it off.": "扣分快來了，直接關掉。",
    "Incoming damage can become your score instead.": "打到你的傷害可以反變成你的分數。",
    "Lock in safety for the rest of the game.": "把整場安全感鎖住。",
    "Big streaks are worth punishing. This is built for that.": "高連勝值得懲罰，這張就是為此而生。",
    "The table has tall streaks. Bring them down.": "場上有人連勝太高，打下來。",
    "The final round needs a little sabotage.": "最後一回合需要一點破壞。",
    "Make the final hit someone else's problem.": "讓最後一擊變成別人的麻煩。",
    "No streak yet? Start one instantly.": "還沒有連勝？立刻開始。",
    "Buy yourself a streak out of nowhere.": "憑空買出連勝。",
    "Too many streaks on the board. Clear the fire.": "場上連勝太多了，先滅火。",
    "Pick the hottest streak and put it out.": "選最高溫的連勝，把它熄掉。",
    "Build streak pressure for the next round.": "為下一回合建立連勝壓力。",
    "Start streaking now and double future gains.": "現在開始連勝，未來收益加倍。",
    "If you lose, lose gracefully and gain something.": "就算輸，也要輸得有收穫。",
    "A bad round can become a comeback.": "糟糕回合也能變成反攻。",
    "Falling behind? Start farming your losses.": "落後了？把失敗變成資源。",
    "Every rough round makes the next one better.": "每個難過回合都會讓下一步更好。",
    "A great answer can set up next round.": "好答案可以鋪好下一回合。",
    "Exact answers deserve legendary rewards.": "精準答案值得傳奇獎勵。",
    "Someone is about to lose. Make it cost extra.": "有人快要輸了，讓他輸得更痛。",
    "Every loser pays you for three rounds.": "接下來三回合，每個輸家都要付你錢。",
    "If you are behind, drag the table down with you.": "如果你落後，就把全場一起拖下去。",
    "Your wrong answers can become everyone's problem.": "你的錯答可以變成所有人的麻煩。",
    "You need the table to stop making sense.": "你需要讓這張桌子失去邏輯。",
    "Your next hand can become much scarier.": "你的下一手牌可以變得更可怕。",
    "First place has a streak bounty on them.": "第一名的連勝就是懸賞。",
    "The leader is exposed. This is a brutal opener.": "領先者暴露了。這是殘酷開局。",
    "Hide your real score before the table reacts.": "在全場反應前藏起真實分數。",
    "Make losing hurt before answers are judged.": "評分前先讓落敗更痛。",
    "A streak is forming. Zap it before it becomes a problem.": "連勝正在形成，趁早電掉。",
    "Higher streaks are exposed. Punish the climb.": "高連勝暴露了，懲罰這次攀升。",
    "Your streak can be converted into points.": "你的連勝可以換成分數。",
    "Big streak, big meal.": "連勝越大，吃得越飽。",
    "You are first. Act like it.": "你是第一名，拿出第一名的姿態。",
    "First place with streak? Become worse to deal with.": "第一名還有連勝？讓自己更難處理。",
    "If this round goes badly, make someone else suffer too.": "這回合出事時，也讓別人一起受苦。",
    "Every future loss can throw a bomb at the table.": "未來每次失敗都可以向場上丟炸彈。",
    "Cap the room at your pace.": "把全房節奏壓到你的速度。",
    "No one gets to streak higher than you anymore.": "從現在起，沒人能連勝高過你。",
    "Active effects are stacking. Sue the problem.": "生效效果堆起來了，直接告它。",
    "Everyone else with effects is vulnerable.": "其他有狀態的人都露出破綻。",
    "Let random chaos haunt the whole match.": "讓隨機混亂纏住整場。",
    "Give one player chaos immediately.": "立刻把混亂送給一位玩家。",
    "Chaos for everyone except you.": "除了你，所有人都吃混亂。",
    "Debuffs are flying. Put up protection.": "負面效果到處飛，先架防護。",
    "Block debuffs for several rounds. Very calm, very annoying.": "擋住好幾回合負面效果。很穩，也很煩。",
    "Send a random problem to someone else.": "把隨機麻煩丟給別人。",
    "Spread random problems across the table.": "把隨機麻煩灑滿全場。",
    "Punish someone who keeps missing answers.": "懲罰一直答錯的人。",
    "One target is ready for sudden death.": "有一個目標準備好進入突然死亡了。",
    "Players ahead of you are future targets.": "領先你的人都是未來目標。",
    "Mark one player so every loss hurts more.": "標記一人，讓他的每次扣分更痛。",
    "Copy your best rarity and build the hand.": "複製你的最高稀有度，強化手牌。",
    "Upgrade your hand by copying above your best.": "複製比你最高更高一級的卡來升級手牌。",
    "Pass the problem to someone else.": "把問題交給別人。",
    "Turn their whole hand into junk.": "把他的整手牌變成垃圾。",
    "That last power was useful. Bring it back.": "上一張能力很好用，把它撿回來。",
    "Pick a rich target and make it personal.": "選個有錢目標，讓事情變私人恩怨。",
    "A clean steal is available. Take a chunk now.": "有乾淨的偷分機會，現在拿一大塊。",
    "Your score has an 8. Cash the omen.": "你的分數有 8，把這個徵兆變現。",
    "Every 8 in your score is worth serious money.": "分數裡每個 8 都值大錢。",
    "Reroll, then keep playing.": "先重抽，再繼續出牌。",
    "Refresh and force a high-rarity upgrade.": "刷新並保證高稀有度升級。",
    "Empty slots are wasted slots. Refill them.": "空位就是浪費，補滿它。",
    "Mostly good, sometimes cursed.": "大多有好處，偶爾很詛咒。",
    "You won last round. Claim the encore.": "你上一回合贏了，拿下安可獎勵。",
    "Someone might already know it. Borrow their homework.": "有人可能已經知道答案，借一下功課。",
    "Peek before you decide who is dangerous.": "先偷看，再決定誰最危險。",
    "Delete their strongest option before they use it.": "在他用之前，刪掉他最強的選項。",
    "Make every round riskier for everyone.": "讓每回合對所有人都更危險。",
    "You lost last round. Tilt luck back toward you.": "你上一回合輸了，把運氣拉回來。",
    "For several rounds, luck is only allowed to help you.": "接下來幾回合，運氣只能幫你。",
    "This round's losers are about to feel it.": "這回合的輸家準備吃苦了。",
    "Trigger sudden death across the table.": "讓全場觸發突然死亡。",
    "Mark someone who looks likely to fail.": "標記看起來快失手的人。",
    "Punish their next bad rounds and steal momentum.": "懲罰他接下來的壞回合，偷走節奏。",
    "The table is relying on powers. Shut them down.": "全場都靠能力卡？把它們關掉。",
    "Disable everyone else and keep your own turn alive.": "停用其他人的能力，同時保留你的回合。",
    "Turn uncertainty into options.": "把不確定變成選項。",
    "Streaks will start attracting lightning.": "連勝會開始吸引雷電。",
    "Let the storm punish higher streaks.": "讓風暴懲罰更高連勝。",
    "Stack buffs now.": "現在開始疊增益。",
    "Trigger every buff and become a problem.": "觸發所有增益，變成全場問題。",
    "Make point loss hurt everyone else too.": "讓你的扣分也痛到其他人。",
    "If you bleed points, the table bleeds harder.": "你流失分數時，全場流得更痛。",
    "Past losses can still become points.": "過去的失敗也能變成分數。",
    "Every lost round becomes a repeat payout.": "每個輸掉的回合都會變成反覆收益。",
    "Secretly prepare a payout if things go badly.": "悄悄準備好失利時的賠付。",
    "Pick someone and make their round miserable.": "選一個人，讓他的回合很難受。",
    "Everyone else loses options, effects, and scoring freedom.": "其他人失去選項、效果和得分自由。",
    "Roll the deck and accept whatever happens.": "擲出牌組，接受結果。",
    "Three chaos powers. No subtlety.": "三張混沌能力，毫不含蓄。",
    "Start building streak pressure every round.": "每回合開始堆連勝壓力。",
    "Give a boost where it helps most.": "把增益送到最有用的位置。",
    "Turn one player into a supply drop jackpot.": "把一位玩家變成補給大獎。",
    "Big payouts are easier to catch when shared.": "大獎被共享後更容易追上。",
    "Mark an opponent before you go for the win.": "衝勝前先標記一個對手。",
    "Wrong answers can become death bombs.": "錯答可以變成死亡炸彈。",
    "Gold cards only. Punish cheap tricks.": "只准金卡。懲罰便宜招數。",
    "Refill with quality and keep your turn going.": "用高品質補牌，繼續你的回合。",
    "Link with someone valuable before scores grow.": "分數拉開前，先連上有價值的人。",
    "Anyone ahead of you is standing too tall.": "任何領先你的人都站得太高了。",
    "Trim the leaders every round and limit their recovery.": "每回合修剪領先者，限制他們回血。",
    "Automate your buff rolls for the whole match.": "把整場的增益抽取自動化。",
    "Turn every round start into a Blue Pill trigger.": "讓每回合開始都觸發 Blue Pill。",
    "Your streak can start burning everyone else.": "你的連勝可以開始灼燒其他人。",
    "A player above you can be hit hard right now.": "現在可以重擊一個領先你的玩家。",
    "You are hard to kill for the next few rounds.": "接下來幾回合你會很難被擊倒。",
    "Scramble the room before stealing a comeback.": "先把房間搞亂，再偷回逆轉。",
    "Harvest streaks and carve down one target.": "收割連勝，削弱一個目標。",

    "Low time. This can help before the round closes.": "時間不多了。這張能在回合結束前幫到你。",
    "Final round. This can still swing the match.": "最後一回合。這張仍有機會翻盤。",
    "Someone is building a dangerous streak. Use this before they snowball.": "有人正在堆危險連勝，雪球滾大前先處理。",
    "You have something worth protecting. This can keep your lead safer.": "你有值得保護的東西，這能讓領先更穩。",
    "The leader is ahead. This helps close the gap.": "領先者拉開了，這能幫你追近。",
    "Someone is stacking power. This can break their setup.": "有人在堆資源，這能破壞他的布局。",
    "Use this when you feel good about your answer.": "對答案有信心時就用這張。",
    "Early rounds give this more time to pay off.": "越早用，越有時間回本。",
    "Your hand can improve. This is a good setup play.": "你的手牌還能變好，這是很好的鋪墊。",
    "You need a shake-up. This can change the table fast.": "你需要改變局面，這張能很快攪動全場。"
  };

  const translations = {
    "zh-Hant": zhHant
  };

  const patternTranslations = {
    "zh-Hant": [
      [/^(\d+)\/(\d+) answered$/, (match) => `${match[1]}/${match[2]} 已回答`],
      [/^(\d+)\/(\d+) answered - (\d+) correct$/, (match) => `${match[1]}/${match[2]} 已回答 · ${match[3]} 正確`],
      [/^(\d+) achievements$/, (match) => `${match[1]} 個成就`],
      [/^(\d+) achievement$/, (match) => `${match[1]} 個成就`],
      [/^(\d+) item in stock$/, (match) => `庫存中有 ${match[1]} 件商品`],
      [/^(\d+) items in stock$/, (match) => `庫存中有 ${match[1]} 件商品`],
      [/^(\d+) total$/, (match) => `共 ${match[1]} 題`],
      [/^(\d+) image \/ (\d+) text \/ (\d+) MC$/, (match) => `${match[1]} 圖片 / ${match[2]} 文字 / ${match[3]} 選擇題`],
      [/^(\d+)\/(\d+) shown$/, (match) => `顯示 ${match[1]}/${match[2]}`],
      [/^(\d+) questions$/, (match) => `${match[1]} 題`],
      [/^(\d+) question$/, (match) => `${match[1]} 題`],
      [/^(\d+) possible duplicate groups? found\. Showing top (\d+)\.$/, (match) => `找到 ${match[1]} 組可能重複項目。顯示前 ${match[2]} 組。`],
      [/^Checking (\d+)\/(\d+) image URLs\.\.\. (\d+) issues? found\.$/, (match) => `正在檢查圖片 URL ${match[1]}/${match[2]}... 已找到 ${match[3]} 個問題。`],
      [/^Checking (\d+)\/(\d+) image URLs\.\.\.$/, (match) => `正在檢查圖片 URL ${match[1]}/${match[2]}...`],
      [/^(\d+)\/(\d+) image questions? need attention\.$/, (match) => `${match[1]}/${match[2]} 道圖片題需要處理。`],
      [/^Round (\d+)$/, (match) => `第 ${match[1]} 回合`],
      [/^Round (\d+)\/(\d+)$/, (match) => `第 ${match[1]}/${match[2]} 回合`],
      [/^(\d+)x streak$/, (match) => `${match[1]}x 連勝`],
      [/^(\d+) points$/, (match) => `${match[1]} 分`],
      [/^([\d,]+) points$/, (match) => `${match[1]} 分`],
      [/^([\d,]+) pts$/, (match) => `${match[1]} 分`],
      [/^(.+) avatar$/, (match) => `${match[1]}的頭像`],
      [/^(.+) answer$/, (match) => `${match[1]}的答案`],
      [/^(.+), choose an answer\.$/, (match) => `${match[1]}，選擇一個答案。`],
      [/^(.+), enter your trivia answer\.$/, (match) => `${match[1]}，輸入你的問答答案。`],
      [/^(.+), enter your trivia answer\. It disappears after locking\.$/, (match) => `${match[1]}，輸入你的問答答案。鎖定後會隱藏。`],
      [/^(.+), your turn\. (.+)'s answer is hidden\.$/, (match) => `${match[1]}，輪到你了。${match[2]} 的答案已隱藏。`],
      [/^(.+) submitted$/, (match) => `${match[1]} 已提交`],
      [/^(.+) waiting$/, (match) => `${match[1]} 等待中`],
      [/^Chat cooldown: (\d+)s$/, (match) => `聊天冷卻：${match[1]} 秒`],
      [/^Power Effects \((\d+)\)$/, (match) => `能力效果（${match[1]}）`],
      [/^Refreshes in (.+)$/, (match) => `${match[1]} 後刷新`],
      [/^Need (.+) more for (.+)\.$/, (match) => `還需要 ${match[1]} 才能購買 ${match[2]}。`],
      [/^(.+) purchased\. Equip it in Customize Card\.$/, (match) => `已購買 ${match[1]}。可在自訂卡牌中裝備。`],
      [/^(.+) is already owned\.$/, (match) => `${match[1]} 已經擁有。`],
      [/^(.+) is not in the current rotation\.$/, (match) => `${match[1]} 不在目前輪換中。`],
      [/^Public (.+) room\. (\d+) rounds, (\d+)s timer, (\d+) player limit\.$/, (match) => `公開 ${match[1]} 房間。${match[2]} 回合、${match[3]} 秒、最多 ${match[4]} 名玩家。`],
      [/^Private (.+) room\. (\d+) rounds, (\d+)s timer, (\d+) player limit\.$/, (match) => `私人 ${match[1]} 房間。${match[2]} 回合、${match[3]} 秒、最多 ${match[4]} 名玩家。`],
      [/^Room (.+) created with (.+) rules\.$/, (match) => `房間 ${match[1]} 已建立，規則：${match[2]}。`],
      [/^(\d+)\/(\d+) voted to kick (.+)\.$/, (match) => `${match[1]}/${match[2]} 已投票踢出 ${match[3]}。`],
      [/^Waiting for the host to deal round (\d+)\.\.\.$/, (match) => `等待房主發出第 ${match[1]} 回合...`],
      [/^Winning answer: (.+)$/, (match) => `勝出答案：${match[1]}`],
      [/^\+(\d+) more$/, (match) => `還有 ${match[1]} 個`],
      [/^Cost: ([\d,]+) points$/, (match) => `花費：${match[1]} 分`],
      [/^Options: (.+)$/, (match) => `選項：${match[1]}`],
      [/^Seed id: (.+)$/, (match) => `種子 ID：${match[1]}`],
      [/^Tested answer: (.*)$/, (match) => `測試答案：${match[1] || "（空白）"}`],
      [/^Normalized answer: (.*)$/, (match) => `正規化答案：${match[1] || "（空白）"}`],
      [/^Saved answer: (.*)$/, (match) => `已儲存答案：${match[1] || "-"}`]
    ]
  };

  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const translatableAttributes = ["aria-label", "placeholder", "title", "data-tooltip", "data-description", "content"];
  const skipTextSelector = [
    "script",
    "style",
    "noscript",
    "template",
    "textarea",
    "code",
    "pre",
    "[data-i18n-skip]",
    "#blackCardText",
    "#questionImageCredit",
    "#devQuestionCredit",
    "#devCreatePreviewCredit",
    "#chatLog .chat-message > span:last-child",
    "#lobbyChatLog .chat-message > span:last-child",
    ".multiple-choice-option"
  ].join(",");

  let currentLanguage = normalizeLanguage(localStorage.getItem(storageKey));
  let observer = null;
  let translating = false;

  function normalizeLanguage(language) {
    const value = String(language || "").trim();
    return supportedLanguages[value] ? value : defaultLanguage;
  }

  function getLanguage() {
    return currentLanguage;
  }

  function splitEdgeWhitespace(value) {
    const text = String(value ?? "");
    const leading = text.match(/^\s*/)?.[0] || "";
    const trailing = text.match(/\s*$/)?.[0] || "";
    return {
      leading,
      core: text.slice(leading.length, text.length - trailing.length),
      trailing
    };
  }

  function translateCore(core, language = currentLanguage) {
    if (!core || language === defaultLanguage) {
      return core;
    }
    const dictionary = translations[language] || {};
    if (Object.prototype.hasOwnProperty.call(dictionary, core)) {
      return dictionary[core];
    }
    const patterns = patternTranslations[language] || [];
    for (const [regex, replacement] of patterns) {
      const match = core.match(regex);
      if (match) {
        return replacement(match);
      }
    }
    return core;
  }

  function translateText(source, language = currentLanguage) {
    const { leading, core, trailing } = splitEdgeWhitespace(source);
    return `${leading}${translateCore(core, language)}${trailing}`;
  }

  function getCurrentTranslation(source) {
    return translateText(source, currentLanguage);
  }

  function shouldSkipTextNode(node) {
    const parent = node?.parentElement;
    return !parent || Boolean(parent.closest(skipTextSelector));
  }

  function translateTextNode(node) {
    if (!node || shouldSkipTextNode(node)) {
      return;
    }
    const current = node.nodeValue || "";
    if (!current.trim()) {
      return;
    }
    const previousSource = textSources.get(node);
    const expected = previousSource ? getCurrentTranslation(previousSource) : "";
    const source = previousSource && (current === expected || current === previousSource)
      ? previousSource
      : current;
    const next = getCurrentTranslation(source);
    textSources.set(node, source);
    if (current !== next) {
      node.nodeValue = next;
    }
  }

  function shouldSkipElement(element) {
    return !element || element.matches?.("script, style, noscript, template, [data-i18n-skip]");
  }

  function getAttributeSource(element, attr, current) {
    let sources = attributeSources.get(element);
    if (!sources) {
      sources = {};
      attributeSources.set(element, sources);
    }
    const previousSource = sources[attr];
    const expected = previousSource ? getCurrentTranslation(previousSource) : "";
    const source = previousSource && (current === expected || current === previousSource)
      ? previousSource
      : current;
    sources[attr] = source;
    return source;
  }

  function translateElementAttributes(element) {
    if (shouldSkipElement(element)) {
      return;
    }
    translatableAttributes.forEach((attr) => {
      if (!element.hasAttribute?.(attr)) {
        return;
      }
      const current = element.getAttribute(attr) || "";
      if (!current.trim()) {
        return;
      }
      const source = getAttributeSource(element, attr, current);
      const next = getCurrentTranslation(source);
      if (current !== next) {
        element.setAttribute(attr, next);
      }
    });
  }

  function translateTree(root = document.body) {
    if (!root) {
      return;
    }
    translating = true;
    try {
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
      }
      if (root.nodeType === Node.ELEMENT_NODE) {
        translateElementAttributes(root);
      }
      const elementRoot = root.nodeType === Node.ELEMENT_NODE ? root : null;
      elementRoot?.querySelectorAll?.("*").forEach(translateElementAttributes);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return shouldSkipTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      let node = walker.nextNode();
      while (node) {
        translateTextNode(node);
        node = walker.nextNode();
      }
    } finally {
      translating = false;
    }
  }

  function translateDocumentChrome() {
    document.documentElement.lang = supportedLanguages[currentLanguage]?.htmlLang || "en";
    document.body?.setAttribute("data-ui-language", currentLanguage);
    document.title = translateText("Trivia Against AI - Play Multiplayer AI Trivia", currentLanguage);
    [
      "meta[name=\"description\"]",
      "meta[property=\"og:title\"]",
      "meta[property=\"og:description\"]",
      "meta[name=\"twitter:title\"]",
      "meta[name=\"twitter:description\"]"
    ].forEach((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        translateElementAttributes(element);
      }
    });
  }

  function syncLanguageSelect() {
    const select = document.querySelector("#uiLanguageSelect");
    if (select && select.value !== currentLanguage) {
      select.value = currentLanguage;
    }
  }

  function translatePage() {
    translateDocumentChrome();
    translateTree(document.body);
    syncLanguageSelect();
  }

  function setLanguage(language, options = {}) {
    const next = normalizeLanguage(language);
    currentLanguage = next;
    if (options.persist !== false) {
      localStorage.setItem(storageKey, next);
    }
    translatePage();
    window.dispatchEvent(new CustomEvent("cards-ai-language-change", {
      detail: { language: next }
    }));
  }

  function observeMutations() {
    if (!document.body || observer) {
      return;
    }
    observer = new MutationObserver((records) => {
      if (translating) {
        return;
      }
      records.forEach((record) => {
        if (record.type === "characterData") {
          translateTextNode(record.target);
          return;
        }
        if (record.type === "attributes") {
          translateElementAttributes(record.target);
          return;
        }
        record.addedNodes.forEach((node) => translateTree(node));
      });
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: translatableAttributes,
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  function initLanguageSelect() {
    const select = document.querySelector("#uiLanguageSelect");
    if (!select) {
      return;
    }
    select.value = currentLanguage;
    select.addEventListener("change", (event) => {
      setLanguage(event.target.value);
    });
  }

  function init() {
    initLanguageSelect();
    translatePage();
    observeMutations();
    window.addEventListener("storage", (event) => {
      if (event.key === storageKey) {
        setLanguage(event.newValue, { persist: false });
      }
    });
  }

  window.CardsAgainstAiI18n = {
    getLanguage,
    setLanguage,
    t: translateText,
    translatePage,
    supportedLanguages
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
