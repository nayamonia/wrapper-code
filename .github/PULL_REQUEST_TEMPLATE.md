<!-- Thanks for contributing. One topic per pull request; small is easier to review. -->

## What changes

<!-- One or two sentences about what changes for the user. -->

Closes #

## How you verified it

<!--
For a provider: which account type, which profiles you ran in a real Claude Code
session, and whether tool calls, subagents and long sessions worked.
For docs or a fix: what you checked. Never paste keys, .env contents or full request logs.
-->

## Checklist

- [ ] `npm test` passes
- [ ] No key, token or `.env` content anywhere in the diff
- [ ] New or changed provider: source comment with the URL and date at the top of `src/providers/<id>.js`, pinned test in `test/catalog.test.js`, row in the README's Providers table
- [ ] Touched the site: `npm run site` and the regenerated `docs/index.html` is committed
- [ ] Translation: commands, variable names, paths and provider ids left untranslated
