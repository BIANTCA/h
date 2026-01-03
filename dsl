loadstring(game:HttpGet("https://raw.githubusercontent.com/infyiff/backup/main/dex.lua"))() 

  -- Simple Sound Logger (no GUI)
local function log(text)
 print("[SoundLogger] " .. text)
end

for _, obj in ipairs(game:GetDescendants()) do
 if obj:IsA("Sound") then
  obj:GetPropertyChangedSignal("Playing"):Connect(function()
   if obj.Playing then
    log("🔊 PLAYED: " .. obj:GetFullName() .. " (Id: " .. tostring(obj.SoundId) .. ")")
   end
  end)
 end
end

game.DescendantAdded:Connect(function(obj)
 if obj:IsA("Sound") then
  obj:GetPropertyChangedSignal("Playing"):Connect(function()
   if obj.Playing then
    log("🔊 PLAYED: " .. obj:GetFullName() .. " (Id: " .. tostring(obj.SoundId) .. ")")
   end
  end)
 end
end)

log("✅ Sound logger started")
