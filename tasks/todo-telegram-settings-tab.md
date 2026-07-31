# API keys settings tab (Telegram + Altrady) - drive the engine, don't reimplement it

## Goal
Add an "API keys" tab to the new app's settings viewer with two sections:
- **Telegram**: token, chat id, send-signals, emoji-in-trend + a "send test" button.
- **Altrady**: key + secret (credential storage only; no test, no restart).
Ported in LOOK from the old app's `TelegramSettings.tsx`, but wired to the C# engine's OWN code
(we're the UI; the engine already does the work).

## Scope decision (Inge: "do it all in one go")
- IN: Telegram + Altrady. Same masked-secret pattern; both persist via `GlobalData.SaveConfiguration()`
  (secrets encrypted by `SecureStringConverter`). Altrady is even simpler - `ApiAltradyViewModel` is a
  pure field map with NO bot/restart (`GlobalData.AltradyApi { Key, Secret }`).
- OUT: exchange API keys (`{Key, Secret, PassPhrase}`, per-exchange via `ExchangeViewModel`). Heavier -
  changing them forces an exchange reconnect/re-sync; not requested. Defer.

## Why it's not a pure UI copy
- The old app's Telegram form talks to the OLD Node engine. The new app is backed by the C# engine.
- The C# Telegram config is NOT in `CryptoScanBot-settings.json` (which the viewer reads) - it lives
  in a separate `CryptoScanBot-telegram.json`, held in `GlobalData.Telegram` (secrets encrypted via
  `SecureStringConverter`). So the current `/api/settings/raw` has no Telegram data.
- The engine has no file-watcher, so writing the file alone does nothing; the bot must be restarted.

## Engine already has all the pieces (reuse, don't rebuild)
- `GlobalData.Telegram` (`SettingsTelegram`: Token, ChatId, EmojiInTrend, SendSignalsToTelegram).
- `GlobalData.SaveConfiguration()` persists `-telegram.json` (encrypts secrets).
- `ThreadTelegramBot.Start(token, chatId)` (stops any existing bot first) / `ThreadTelegramBot.Stop()`.
- Test message: `ThreadTelegramBot.ChatId = chatId; GlobalData.AddTextToTelegram("...")`.
- `ApiTelegramViewModel.Load/SaveConfig` is the exact field mapping the desktop dialog uses.

## Approach (3 layers)

### Phase 1 - C# engine (avalonia branch -> PR to Marius, like GetBarometerValues)
Add SignalR hub commands to `CryptoSignalHub` that call the engine's existing Telegram code:
- [ ] `GetTelegramSettings()` -> `TelegramSettingsDto { HasToken, HasChatId, EmojiInTrend,
      SendSignalsToTelegram, IsRunning }`. MASKED: never returns the secrets themselves.
- [ ] `ApplyTelegramSettings(token, chatId, emojiInTrend, sendSignals)` -> update `GlobalData.Telegram`
      (blank token/chatId = KEEP existing, matching write-only UX), `GlobalData.SaveConfiguration()`,
      then `ThreadTelegramBot.Start(token, chatId)` if sendSignals else `Stop()`. Return the new
      masked DTO. Mirrors `ApiTelegramViewModel.SaveConfig` + the dialog's bot (re)start.
- [ ] `SendTelegramTestMessage()` -> `ThreadTelegramBot.ChatId = ...; GlobalData.AddTextToTelegram(
      "Test message from CryptoScanBot")`. Returns ok/throws.
- [ ] `GetAltradySettings()` -> `AltradySettingsDto { HasKey, HasSecret }` (masked).
- [ ] `ApplyAltradySettings(key, secret)` -> update `GlobalData.AltradyApi` (blank = keep existing),
      `GlobalData.SaveConfiguration()`. No restart (Altrady is on-demand). Return masked DTO.
- All additive; new `TelegramSettingsDto` + `AltradySettingsDto`. NEEDS a live runtime test with Inge
  (bot actually starts + a real test message arrives) - not shippable on compile-check alone.

### Phase 2 - bridge (cryptoscanbot-ui)
- [ ] `SignalrSource`: telegram get/apply/test + altrady get/apply invoking the RPCs (reject when hub
      not connected).
- [ ] `HybridSource` passthrough + optional methods on `ScannerDataSource`.
- [ ] `GET/POST /api/telegram`, `POST /api/telegram/test`, `GET/POST /api/altrady`.

### Phase 3 - web (cryptoscanbot-ui)
- [ ] New "API keys" tab in `SettingsViewer.tsx` (key icon) with a Telegram section (ported from the
      old app's `TelegramSettings.tsx`: token + chat id write-only/masked "leave blank to keep", two
      toggles, Save, Send-test, BotFather how-to) and an Altrady section (key + secret, masked, Save).
- [ ] `lib/api.ts`: telegram fetch/save/test + altrady fetch/save.
- [ ] These sections have a REAL working Save (unlike the other preview-only tabs): each is a
      self-contained object with a dedicated engine command, so it does NOT depend on the big P1
      settings write-back / in-place merge. Save is enabled only when the hub is connected.

## Deliberately out of scope (for now, per Inge)
- Exchange API keys (`{Key, Secret, PassPhrase}`, per-exchange) - forces a reconnect/re-sync; defer.
- The general settings write-back (P1) - unaffected; Telegram/Altrady get their own dedicated paths.

## PRs
- PR A: engine telegram + altrady hub commands (avalonia -> Marius).
- PR B: bridge + web API-keys tab (one UI PR, needs PR A's engine build to test).

## Test
- Engine: build the avalonia binary, Inge runs it, set a real token+chatid via the new tab, Save,
  Send-test -> message arrives in Telegram; toggle Send-signals and confirm a real signal is pushed.
  Altrady: set key/secret, Save, reopen -> shows "configured".
- `pnpm -r typecheck` green; manual test before commit.

## Review
- Built all three layers. Engine changes are confined to `CryptoScanner.Core/SignalR/` (the hub +
  a new `ApiKeysDtos.cs`) - NO engine/business-logic file touched; the hub only calls existing engine
  code. Committed locally on avalonia `feat/signalr-apikeys-settings` (3a513c98), NOT pushed/PR'd yet
  (more engine changes coming - hold the Marius PR).
- Bridge: `SignalrSource` + `HybridSource` + optional `ScannerDataSource` methods + `GET/POST
  /api/telegram`, `POST /api/telegram/test`, `GET/POST /api/altrady` (with a small JSON body reader).
- Web: `ApiKeysTab.tsx` (Telegram + Altrady sections, write-only masked secrets, working Save +
  Send-test), wired into `SettingsViewer` as a special tab placed before Lists. It has a real Save
  (green "Saves live" pill) while the draft tabs stay "Save disabled".
- Alignment fix: the header row height depended on the amber "Save disabled" badge; the API-keys tab
  now shows an emerald "Saves live" badge of the same size, so headers line up.
- `pnpm -r typecheck` + web build green. Bridge routes verified live: against the OLD engine they
  return 503 ("Method does not exist"), confirming the chain is wired and waiting on the new engine.
- LIVE TEST (with the new engine binary): pending Inge - set real token/chatid, Save, Send-test.
- UI shipped as v0.8.18. Engine PR to Marius deferred (more changes first).
