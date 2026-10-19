local Tumblr = loadstring(game:HttpGet('https://pastebin.com/raw/2BGUWvbd'))()
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local CoreGui = game:GetService("CoreGui")

local gameInfo
local ok, info = pcall(function()
 return MarketplaceService:GetProductInfo(game.PlaceId)
 end)
gameInfo = (ok and info and info.Name) or "Unknown Game"

local Window = Tumblr:Init({
 Name = "Tumblr Hub",
 Subtitle = "Script loader V3",
 FolderName = "TumblrConfigs",
 FileName = tostring(game.GameId)..".json"
})

local MainTab = Window:CreateTab("Main", 4483362458)
_G.MainTab = MainTab
local ScriptTab = Window:CreateTab("Script", 4483362458)

Window:CreateSettingsParagraph({
 Title = "3 February 2026",
 Content = "You can delete the scripts that you run in this script loader."
})


ScriptTab:CreateSection("ScriptBlox Search")
local currentQuery = gameInfo

ScriptTab:CreateInput({
 Name = "Search Script:",
 PlaceholderText = "Game name",
 RemoveTextAfterFocusLost = false,
 CurrentValue = currentQuery,
 Callback = function(value)
 currentQuery = value
 Tumblr:Notify({
  Title = "Search Updated",
  Content = "Search query set to: "..tostring(value),
  Duration = 2
 })
 end
})

-- === CoreGui Snapshot Utils ===

local function snapshotCoreGui()
local t = {}
for _, v in ipairs(CoreGui:GetChildren()) do
t[v] = true
end
return t
end

local function diffCoreGui(before)
local added = {}
for _, v in ipairs(CoreGui:GetChildren()) do
if not before[v] then
table.insert(added, v)
end
end
return added
end

-- === ScriptBlox ===

local function fetchScripts(query)
local scripts = {}
local page = 1
local hasNext = true
while hasNext do
local url = ("https://scriptblox.com/api/script/search?q=%s&page=%d")
:format(HttpService:UrlEncode(query), page)
local success, result = pcall(function()
 return game:HttpGet(url)
 end)
if not success then break end

local ok, data = pcall(function()
 return HttpService:JSONDecode(result)
 end)
if not ok or not data.result or not data.result.scripts then break end

for _, s in ipairs(data.result.scripts) do
if not s.key then
table.insert(scripts, s)
end
end

hasNext = data.result.hasNextPage or false
page += 1
task.wait(0.1)
end
return scripts
end

local function formatScriptInfo(s)
local lines = {}
table.insert(lines, s.scriptType == "Paid" and "💰 Paid Script" or "🆓 Free Script")
table.insert(lines, s.isPatched and "⚠️ Patched" or "✅ Working")
table.insert(lines, s.key and "🔒 Requires Key" or "🔓 Keyless")
table.insert(lines, s.isUniversal and "🌐 Universal" or "🎯 Game-Specific")
table.insert(lines, "")
table.insert(lines,
 string.format("👍 %d   👎 %d   👁️ %d",
  s.likeCount or 0,
  s.dislikeCount or 0,
  s.views or 0
 )
)
return table.concat(lines, "\n")
end

-- === GUI Runner ===

local function showScripts(scripts)
for i, s in ipairs(scripts) do
local gameName = (s.game and s.game.name) or "Unknown Game"
ScriptTab:CreateSection(gameName)

local title = "["..i.."] "..(s.title or "Untitled")
ScriptTab:CreateParagraph({
 Title = title,
 Content = formatScriptInfo(s)
})

local running = false
local spawnedGuis = {}

local button
button = ScriptTab:CreateButton({
 Name = "Run Script",
 Callback = function()
 if not running then
 local before = snapshotCoreGui()

 local ok, err = pcall(function()
  loadstring(s.script)()
  end)

 if not ok then
 Tumblr:Notify({
  Title = "Error",
  Content = tostring(err),
  Duration = 4
 })
 return
 end

 task.wait(0.2)
 spawnedGuis = diffCoreGui(before)

 if #spawnedGuis == 0 then
 Tumblr:Notify({
  Title = "Notice",
  Content = "Script ran but can't detected.",
  Duration = 3
 })
 return
 end

 running = true
 button:Set("Name", "Delete Script UI")

 Tumblr:Notify({
  Title = "Success",
  Content = "Script detected & tracked.",
  Duration = 3
 })
 else
  for _, gui in ipairs(spawnedGuis) do
 pcall(function()
  gui:Destroy()
  end)
 end

 spawnedGuis = {}
 running = false
 button:Set("Name", "Run Script")

 Tumblr:Notify({
  Title = "Removed",
  Content = "Script removed.",
  Duration = 3
 })
 end
 end
})
end
end

ScriptTab:CreateButton({
 Name = "Load Scripts",
 Callback = function()
 local scripts = fetchScripts(currentQuery)
 if scripts and #scripts > 0 then
 Tumblr:Notify({
  Title = "Updated",
  Content = "Loaded "..#scripts.." scripts.",
  Duration = 3
 })
 showScripts(scripts)
 else
  Tumblr:Notify({
  Title = "No Scripts",
  Content = "No scripts found.",
  Duration = 3
 })
 end
 end
})

local Universal = loadstring(game:HttpGet("https://pastebin.com/raw/436invAL"))()
Universal.CreateUniversalTab(
 Window,
 Tumblr,
 game:GetService("Players"),
 game:GetService("RunService")
)
