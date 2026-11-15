# n8n-nodes-bluebot

BlueBot's community node package for [n8n](https://n8n.io). It adds two nodes:

- **BlueBot** calls every operation in the [BlueBot API](https://usebluebot.com/docs/api): send a text now or later,
  read texts, check whether a number uses iMessage, upload and download files, and manage settings, stops, events and
  webhooks.
- **BlueBot Trigger** starts a workflow the moment BlueBot posts an event, such as a text coming in. It makes and
  deletes its own BlueBot webhook and checks the signature on every request.

Texts sent from n8n show `source: "n8n"` in BlueBot. What each field does is on
[usebluebot.com/docs/n8n](https://usebluebot.com/docs/n8n); this file is for installing, building and testing the
package. Nothing here is published to npm yet.

## Install it in n8n

The package needs n8n 1.85 or newer (it uses n8n's `NodeConnectionTypes`). It has no runtime dependencies.

On your own n8n, as the owner or an admin, go to **Settings → Community Nodes**, press **Install a community node**,
type `n8n-nodes-bluebot`, tick the box about the risks of community nodes and press **Install**. Search the nodes panel
for "BlueBot" to check.

If n8n can't install from the panel (community packages turned off, no network from the container, a read-only image),
install it by hand and restart n8n:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-bluebot
```

In Docker, do the same in a volume mounted at `/home/node/.n8n`, or build an image `FROM n8nio/n8n` with the package
installed, so it survives the container being replaced. In queue mode every worker runs nodes, so each worker's image
needs the package too.

To try a build from this folder before anything is published, pack it and install the tarball:

```bash
npm ci && npm run build && npm pack          # writes n8n-nodes-bluebot-0.1.0.tgz
cd ~/.n8n/nodes && npm install /path/to/n8n-nodes-bluebot-0.1.0.tgz
```

n8n Cloud installs only community nodes n8n has verified. Until it lists this one, use n8n's **HTTP Request** node
there, as the docs page describes.

## The credential: BlueBot API

| Field | What it is |
| --- | --- |
| API Key | A `bb_live_…` key from BlueBot's **Developers → API keys** page. The trigger needs the `webhooks:manage` scope and the credential test needs `account:read`. n8n stores it encrypted. |
| Base URL | `https://usebluebot.com/api/v1`. Leave it unless BlueBot support asks you to change it. |

Every request carries `Authorization: Bearer <key>` and `BlueBot-Client: n8n`. **Save** tests the key with
`GET /v1/me`. A refused test says why in BlueBot's words: the key isn't valid (401), the key lacks `account:read`
(403), the Base URL is wrong (404), or the key made too many requests (429).

## The BlueBot node

Pick a **Resource**, then an **Operation**. The node makes one request per input item, and each record it answers is
one output item paired with the item it came from.

| Resource | Operation | Calls | Fields |
| --- | --- | --- | --- |
| Message | Send Text | `POST /v1/messages` | Send To (Person or Group Chat), To or Group Chat ID, Text; under Add Field: Files, Service, Send At, Expires At, Metadata, Idempotency Key |
| Message | Get | `GET /v1/messages/{id}` | Message ID |
| Message | Get Many | `GET /v1/messages` | Return All, Limit; Filters: Chat ID, Contact ID, Created After, Created Before, Direction, Person, Source, State |
| Message | Update | `PATCH /v1/messages/{id}` | Message ID; Update Fields: Text, Send At, Expires At, Metadata (replaces it whole) |
| Message | Cancel | `POST /v1/messages/{id}/cancel` | Message ID |
| Message | Resolve | `POST /v1/messages/{id}/resolve` | Message ID, Action (Mark Sent or Send Again) |
| File | Upload | `POST /v1/files` | Input Binary Field (default `data`); Additional Fields: Name |
| File | Get | `GET /v1/files/{id}` | File ID, Download, Put Output File in Field |
| Chat | Get | `GET /v1/chats/{id}` | Chat ID |
| Chat | Get Many | `GET /v1/chats` | Return All, Limit; Filters: Is Group, Person |
| Lookup | Check iMessage | `GET /v1/lookup` | Number (a phone number or email address) |
| Device | Get Mac | `GET /v1/device` | |
| Device | Get BlueBot Status | `GET /v1/status` | |
| Account | Get | `GET /v1/me` | |
| Settings | Get | `GET /v1/settings` | |
| Settings | Update | `PATCH /v1/settings` | Time Zone, Pace Seconds, New People Per Day, Quiet Hours Enabled, Start and End, Smart Quiet Hours, Stop Words Enabled, Expiry Hours, Inbound Mode, Paused Until, Resume Sending |
| Stop | Add | `POST /v1/stops` | Person |
| Stop | Get Many | `GET /v1/stops` | Return All, Limit |
| Stop | Remove | `DELETE /v1/stops/{person}` | Person |
| Event | Get | `GET /v1/events/{id}` | Event ID |
| Event | Get Many | `GET /v1/events` | Return All, Limit; Filters: Since, Types |
| Webhook | Create | `POST /v1/webhooks` | URL, Events (or All Events); Additional Fields: Description |
| Webhook | Get | `GET /v1/webhooks/{id}` | Webhook ID |
| Webhook | Get Many | `GET /v1/webhooks` | Return All, Limit |
| Webhook | Update | `PATCH /v1/webhooks/{id}` | Webhook ID; Update Fields: URL, Events, Description, Paused |
| Webhook | Delete | `DELETE /v1/webhooks/{id}` | Webhook ID |
| Webhook | Send Test Event | `POST /v1/webhooks/{id}/test` | Webhook ID, Event Type |
| Webhook | Rotate Secret | `POST /v1/webhooks/{id}/rotate-secret` | Webhook ID |
| Webhook Delivery | Get Many | `GET /v1/webhooks/{id}/deliveries` | Webhook ID, Return All, Limit; Filters: State |
| Webhook Delivery | Replay | `POST /v1/webhooks/{id}/deliveries/{delivery}/replay` | Webhook ID, Delivery ID |

The node is marked usable as an AI tool, so an n8n AI Agent can call it.

**Send Text's files.** **File IDs** takes `file_` ids from File → Upload, separated by commas. **Binary Properties**
names binary properties on the item (such as `data`); the node uploads each with `POST /v1/files` and then sends their
ids. Up to 10 files, each up to 25 MB.

**Dates.** n8n's date picker gives a time with no zone, which the node reads in the workflow's time zone (Workflow
settings → Timezone) and sends with its offset. A time that already has a zone, such as `2026-11-14T15:00:00-05:00` or
a Luxon date from an expression, is sent as that moment.

**Idempotency.** Every POST carries an `Idempotency-Key`. Unless Send Text's **Idempotency Key** is set, it is made
from the execution, the node and the item's index, so **Retry On Fail** and the node's own retries never send a text
twice. Each upload before a send uses that key plus `:file0`, `:file1` and so on, and its multipart body is built the
same way on every try, so a retried upload is answered from the first one.

**Get Many.** **Return All** follows `next_cursor` to the end, 100 a page. Otherwise **Limit** (default 50) caps the
items, and the node asks for no more than it still needs.

**Download.** File → Get with **Download** on reads the file's signed `url` (good for an hour) without your key and
puts the bytes in the binary field you name, with the file's name and type.

### When a call fails

The node's error is BlueBot's `message`, its description is the `hint` followed by `(code, request_id)`, and the code,
HTTP status and request id are in the error's details. With **Continue On Fail** on, the failed item's output is
`{ error, code, status, hint, request_id, doc_url, details }` and the other items go on.

On a 429, a 5xx, a 409 that carries `Retry-After`, or a dropped connection, the node waits and tries again, up to twice,
with the same idempotency key: it waits the `Retry-After` header's seconds (or the body's `retry_after`), else 0.5 s,
then 1 s, with a little jitter. When BlueBot asks for a wait over 60 seconds it fails at once rather than hold the
workflow. A DELETE is never retried after a dropped connection. A held text and a text canceled because the person is
on your stop list are successes, not errors.

## The BlueBot Trigger node

| Field | What it is |
| --- | --- |
| Events | Any of BlueBot's 22 event types, such as Message Received, Message Failed or Contact Stopped. Default: Message Received. |
| Output | **Record** (the default) puts out the event's `data`: the message, contact or enrollment. **Whole Event** puts out the envelope too: `id`, `type`, `api_version`, `timestamp` and `data`. |

When the workflow is activated, or **Listen for test event** is pressed, the node:

1. deletes any BlueBot webhook already pointed at its own URL (an earlier activation's, whose secret it no longer has);
2. makes a webhook with `POST /v1/webhooks` to n8n's webhook URL for the chosen events, described as
   `n8n: <workflow name>`;
3. keeps the webhook's id and `whsec_` signing secret in the workflow's static data.

On later activations it checks that webhook still exists, points at the same URL and listens for the same events, and
makes a new one when it doesn't. A webhook BlueBot paused after 72 hours of failed deliveries is turned back on; one
you paused yourself is left paused. Deactivating the workflow deletes the webhook.

Each request is checked before the workflow starts: the Standard Webhooks signature over the raw body, with the stored
secret, and a timestamp no more than five minutes old. Either of the two signatures sent while a secret is being rotated
is accepted. A request that fails the check is answered 401 and starts nothing. An event type the node isn't set to
listen for is answered 200 and starts nothing.

### n8n on your own server: WEBHOOK_URL

BlueBot posts only to public `https://` addresses on the default port. Behind a reverse proxy, n8n must be told its
public address, or the trigger registers `http://localhost:5678/…` and BlueBot refuses it. The node then fails with
"BlueBot couldn’t reach this URL" and says which address n8n gave it.

```bash
WEBHOOK_URL=https://n8n.example.com/
N8N_PROXY_HOPS=1
```

Restart n8n after changing it, then deactivate and activate each workflow with a BlueBot Trigger so it makes a webhook
at the new address. On a laptop with no public address, a tunnel such as
`cloudflared tunnel --url http://localhost:5678` gives one to put in `WEBHOOK_URL`.

## Build and test

Use Node 22 (Node 18.17 or newer works).

```bash
npm ci
npm run build       # TypeScript to dist/, then the icons and codex files beside it
npm run lint        # n8n's own community node rules (@n8n/node-cli's ESLint config)
npm test            # Vitest: every operation's request, paging, retries, uploads, the trigger and signatures
npm run typecheck   # the package and the tests
```

The tests use stand-ins for n8n's function contexts and fake only n8n's request helpers, so the node's own code runs
for real and nothing reaches a network. The fake API answers with the examples in `test/examples.generated.json`.

### Regenerating from the API

`nodes/shared/api.generated.ts` (the event types, message states, sources and delivery states the dropdowns offer) and
`test/examples.generated.json` (each operation's and event's example) come from the API manifest:

```bash
npm run generate                       # in this folder
node packages/codegen/regenerate.mjs   # at the repository root: rebuilds the manifest, then every package
```

`scripts/generate.mjs` uses only Node's standard library. A test fails while either file is out of date with the
manifest; `node scripts/generate.mjs --check` says the same without writing.

### Adding a resource or operation

Each resource is one file in `nodes/BlueBot/resources/` exporting its option, its fields and a handler per operation,
plus one line in `nodes/BlueBot/resources/index.ts`. Add its requests to `test/resources.test.ts`.

## Layout

| Path | What it is |
| --- | --- |
| `credentials/BlueBotApi.credentials.ts` | The BlueBot API credential and its test. |
| `nodes/BlueBot/BlueBot.node.ts` | The action node: resource and operation lists, one request per item, Continue On Fail. |
| `nodes/BlueBot/resources/` | One file per resource. |
| `nodes/BlueBotTrigger/BlueBotTrigger.node.ts` | The trigger node: its webhook's lifecycle and the signature check. |
| `nodes/shared/transport.ts` | Requests, errors, retries and paging. |
| `nodes/shared/signature.ts` | Standard Webhooks verification. |
| `nodes/shared/dates.ts`, `idempotency.ts`, `multipart.ts` | Dates with offsets, idempotency keys, upload bodies. |
| `nodes/*/*.node.json` | n8n's codex files: category Communication, links to the docs. |
| `icons/` | The light and dark icons. |
| `scripts/generate.mjs` | Writes the generated files from the API manifest. |

## Releasing

n8n verifies only community nodes published from GitHub Actions with an npm provenance statement, so this folder is
published from its own public repository, [usebluebot/n8n-nodes-bluebot](https://github.com/usebluebot/n8n-nodes-bluebot),
by `.github/workflows/publish.yml`. BlueBot's own repository stays the source: change the package here, then copy the
folder across and tag it.

1. Bump `version` in `package.json` here and merge it.
2. Copy the folder into a clone of the public repository, commit and push. From BlueBot's repository root:

   ```bash
   git archive HEAD integrations/n8n | tar -x --strip-components=2 -C ../n8n-nodes-bluebot
   ```

3. Tag the version there and push the tag (`git tag 0.1.1 && git push origin 0.1.1`). The Publish workflow checks
   that the tag is the package's version, builds, lints, tests and publishes with provenance. Its `ci.yml` checks
   every push and pull request there.

The first publish signs in to npm with a granular access token saved as the public repository's `NPM_TOKEN` secret,
because npm sets up trusted publishing only on a package that already exists. After it, the package's trusted publisher
on npmjs.com is that repository's `publish.yml`, and the secret is deleted.

`npx @n8n/scan-community-package n8n-nodes-bluebot` checks a published version the way n8n's verification does. The
package is submitted for verification, which lists it on n8n Cloud, through the n8n Creator Portal.

## License

MIT. See `LICENSE`.
