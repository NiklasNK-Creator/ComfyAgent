# ComfyAgent

AI Assistant Extension for ComfyUI.
- OpenRouter LLM Agent with auto-dynamic free model selection or custom endpoint/model.
- Direct Canvas & Node Introspection, Node Copy-Paste to Chat.
- Custom Node Search, GitHub Clone, Manager Auto-Install with approval.
- Auto-restart backend with seamless session recovery & proactive foreground trigger.
- Code Optimizer & Node Fixer with automatic zip backup.
- Cloud test run protection & slash commands `/model`, `/settings`, `/help`, `/session`, `/new`.

## Agent Control

The model has a mandatory checkpoint tool for multi-step work. It must review
completed steps, remaining steps, essential connections, missing information,
and choose `continue`, `ask_user`, or `stop`. A checkpoint that chooses
`ask_user` returns control to the UI; it cannot silently continue.

For image workflows, the agent must verify model, positive and negative
 conditioning, latent input, sampler inputs, VAE, and an output node before
 claiming completion.

## License and Use

This project is private-use software for the author and authorized users.
Personal, private use is permitted. Copying, redistributing, publishing,
selling, sublicensing, modifying for redistribution, or using this project in
another product is not permitted without written permission from the author.

Developer-only files such as `overview.html`, `IMPROVEMENT_ROADMAP.md`, local
settings, sessions, credentials, backups, and publishing credentials are not
part of the public release.
