local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local player = Players.LocalPlayer
local highlightObjects = {}

-- FUNCTION: Aktifkan highlight merah (bukan toggle)
local function activateRedHighlight()
    local highlightActive = true
    
    -- Highlight semua pemain saat ini dengan warna merah
    for _, plr in pairs(Players:GetPlayers()) do
        if plr ~= player and plr.Character and not highlightObjects[plr] then
            local highlight = Instance.new("Highlight")
            highlight.FillColor = Color3.fromRGB(255, 50, 50)  -- MERAH
            highlight.OutlineColor = Color3.fromRGB(100, 0, 0)  -- Outline merah gelap
            highlight.FillTransparency = 0.3  -- Lebih transparan
            highlight.Parent = plr.Character
            highlightObjects[plr] = highlight
        end
    end
    
    -- Auto highlight pemain baru yang join
    Players.PlayerAdded:Connect(function(plr)
        plr.CharacterAdded:Connect(function(char)
            if highlightActive and plr ~= player and not highlightObjects[plr] then
                local highlight = Instance.new("Highlight")
                highlight.FillColor = Color3.fromRGB(255, 50, 50)  -- MERAH
                highlight.OutlineColor = Color3.fromRGB(100, 0, 0)  -- Outline merah gelap
                highlight.FillTransparency = 0.3
                highlight.Parent = char
                highlightObjects[plr] = highlight
            end
        end)
    end)
    
    -- Update highlight setiap frame
    RunService.RenderStepped:Connect(function()
        if highlightActive then
            for _, plr in pairs(Players:GetPlayers()) do
                if plr ~= player and plr.Character and not highlightObjects[plr] then
                    local highlight = Instance.new("Highlight")
                    highlight.FillColor = Color3.fromRGB(255, 50, 50)  -- MERAH
                    highlight.OutlineColor = Color3.fromRGB(100, 0, 0)  -- Outline merah gelap
                    highlight.FillTransparency = 0.3
                    highlight.Parent = plr.Character
                    highlightObjects[plr] = highlight
                elseif plr ~= player and not plr.Character and highlightObjects[plr] then
                    if highlightObjects[plr] then 
                        highlightObjects[plr]:Destroy() 
                        highlightObjects[plr] = nil
                    end
                end
            end
        end
    end)
end

-- Jalankan fungsi
activateRedHighlight()
