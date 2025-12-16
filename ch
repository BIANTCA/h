local Players = game:GetService("Players")
local CHMSenabled = false

local function CHMS(player)
    if player.Character and player.Character:FindFirstChild("Humanoid") then
        for _, part in pairs(player.Character:GetDescendants()) do
            if part:IsA("BasePart") then
                local chams = Instance.new("BoxHandleAdornment")
                chams.Name = player.Name .. "_CHMS"
                chams.Adornee = part
                chams.AlwaysOnTop = true
                chams.ZIndex = 10
                chams.Size = part.Size
                chams.Transparency = 0.3
                chams.Color3 = Color3.new(1, 0, 0)
                chams.Parent = player.Character
            end
        end
    end
end

local function clearCHMS()
    for _, player in pairs(Players:GetPlayers()) do
        if player.Character then
            for _, obj in pairs(player.Character:GetDescendants()) do
                if obj.Name:find("_CHMS") then
                    obj:Destroy()
                end
            end
        end
    end
end

local function toggleChams()
    if CHMSenabled then
        CHMSenabled = false
        clearCHMS()
    else
        CHMSenabled = true
        local localPlayer = Players.LocalPlayer
        for _, player in pairs(Players:GetPlayers()) do
            if player ~= localPlayer then
                CHMS(player)
            end
        end
    end
end

toggleChams()
