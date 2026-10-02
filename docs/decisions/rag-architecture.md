# RAG architecture and source policy

**Status: draft; owner decisions remain open.** This document records constraints,
provenance, and implementation candidates. It does not authorize ingestion, external
provider use, or activation of an assistant. Revisit the live prices and provider
terms before any implementation is enabled.

## Decisions already established

- OpSmart RAG is provider-neutral, read-only, and disabled until its sources, rights,
  provider, retention, and cost are approved.
- For the first P3-04 rule, the owner chose an internally supplied SOP with clear
  usage rights as the intended source route on 2026-10-01. This selects a source
  approach, not a specific document: no file or rights evidence has been supplied or
  approved. Record its audience, applicability, owner/rights evidence, and review or
  expiry date before any ingestion; do not ingest a document until then.
- Changing farm facts are read from the existing farm-scoped query contracts at answer
  time. They are not copied into a stale vector index.
- Retrieval must apply the authorized farm scope before ranking; document text is
  untrusted input; answers need source citations and must abstain when evidence is weak.
- Fine-tuning is out of scope. The supplied `finetune-prep-a.zip` is a design reference
  only; no source code, sample corpus, or dependencies are reused without provenance
  and license confirmation.

## Reference archive provenance

The owner supplied `finetune-prep-a.zip`; SHA-256:
`21B5D900870EAE8A4E183933AF3947DC08CCE921B5173D8F0B08711C38C66175`.
The inspected archive contains no LICENSE, LICENCE, COPYING, or NOTICE file, and no
commit ID was included. The README describes a RAG application using PDF/text
extraction, SentenceTransformers embeddings, and ChromaDB. Treat these only as
architecture examples until the owner supplies license/provenance information.

The repository scan on 2026-10-01 found no SOP/manual corpus file. The only matching
reference document is `docs/reference/feature-breakdown.md`, which describes product
features and is not an authoritative cultivation procedure. The README also says
hosting/deployment has not been created; no production database host can be inferred
from this checkout.

## Proposed source registry policy

For the first corpus, consider only individually approved, curated SOP or cultivation
guide documents. Do not index private farm uploads, credentials, personal data,
unapproved third-party manuals, or the reference archive's example documents.
The application source registry should eventually record, at minimum:

| Field                                            | Purpose                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| source ID, title, content hash, version          | Stable citation and change detection                           |
| publisher/owner and rights evidence              | Confirm authority to store and process the material            |
| audience (`shared` or an explicitly scoped farm) | Prevent access outside the approved audience                   |
| classification and approval actor/time           | Show who reviewed the source and when                          |
| effective date, expiry/review date, status       | Exclude stale or revoked guidance                              |
| retention rule and deletion evidence             | Remove source content, chunks, and vectors when due or revoked |
| original location/reference                      | Preserve traceability to the authoritative document            |

The labels and field list are a design proposal, not an approved policy or migration.
An expired, revoked, unlicensed, or audience-ambiguous source must be excluded from
retrieval. Reindexing must replace the prior generation atomically; deletion must cover
the registry record, extracted text, chunks, and vectors and be auditable.

## Provider and vector-store candidates

The production hosting provider and its PostgreSQL configuration are not established
in this workspace. Keep both choices open until that environment is selected and
verified.

| Option                         | Fit                                                                                                                                 | Conditions and trade-offs                                                                                                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL + pgvector          | First candidate if the chosen PostgreSQL host supports it; keeps metadata and vectors near existing tenant-scoped data and backups. | The extension's server files must be installed and the host must allow it to be enabled. Confirm version, extension availability, migration privileges, backup/restore, and filtered-search behavior on the actual host before choosing.                                                                |
| Qdrant, self-hosted or managed | Separate vector-search service with documented payload filtering and tenant strategies.                                             | Adds a service, credentials, network boundary, backup/restore work, and operating cost. A hosted shared collection would require an enforced tenant payload filter on every query. Managed pricing is usage-based beyond its limited free tier; do not treat prototype capacity as production approval. |

pgvector's official project documents exact and approximate vector search, including
HNSW and IVFFlat. PostgreSQL extension installation depends on installed server files
and privileges, so support cannot be inferred from the application's current PostgreSQL
tests. Qdrant documents payload-filter tenant isolation; application code would still
have to derive that filter from the verified session and fail closed if it is absent.

## Embedding and answer-model candidates

- **Local model:** avoids sending document text to a hosted embedding API, but adds
  model distribution, runtime memory/CPU, deployment, and latency requirements. Measure
  Indonesian retrieval quality and host capacity before selecting one.
- **Hosted embedding API:** operationally simple but sends approved document text and
  queries outside the OpSmart deployment. As a current cost reference only, OpenAI's
  `text-embedding-3-small` page lists USD 0.02 per 1 million input tokens. OpenAI states
  API data is not used for model training by default; abuse-monitoring logs can retain
  content for up to 30 days by default. These terms and price must be rechecked and
  explicitly approved before sending any content.
- **Answer generation:** model/provider, retention controls, and budget ceiling remain
  unselected. Do not send farm data or SOP content to a model provider until approved.

No option is selected. A cost estimate should use the expected number and size of
approved documents, expected reindex frequency, query volume, and the selected host's
vector/storage pricing. Add a hard monthly limit and graceful disable path before
enabling any paid provider.

## External source candidates reviewed (not approved)

Initial catalog review on 2026-10-01 found potential official references, but none is
cleared for ingestion or use by P3-04. A repository listing or public download does not
by itself grant OpSmart the right to store, extract, chunk, embed, or display excerpts.

| Candidate                                                                                                                                                                 | Catalog evidence and fit                                                                                                                                                                                                                       | Access and rights status                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Panduan Budidaya Sayuran dan Tanaman Obat di Pekarangan](https://repository.pertanian.go.id/items/daa53288-41d6-4dfa-9bc7-6145c22fcec1), 2022                            | Kementan repository lists authors and Direktorat Sayuran dan Tanaman Obat as publisher; it covers home-garden vegetables and medicinal plants. It may fit selected crop units, after checking crop scope and currentness.                      | The item page shows no per-item reuse license. Kementan's [End User Agreement](https://repository.pertanian.go.id/info/end-user-agreement) grants the repository a non-exclusive distribution right from the author/copyright owner; it does not expressly grant OpSmart downstream processing or reuse rights. Not cleared. |
| [Vertiminaponik: Cara Baru Berbudidaya Sayuran dan Ikan](https://repository.pertanian.go.id/items/e46817fe-6de9-4590-bc8a-4b278036cc39), 2013                             | BPTP Jakarta describes a small-scale integrated fish-and-vegetable system. It is relevant background for circular water use, but not evidence for a specific transfer-water recommendation without reviewing the procedure and its conditions. | Kementan repository item; no per-item reuse license was shown. The same End User Agreement does not explicitly grant OpSmart processing rights. The 2013 material needs a currentness review. Not cleared.                                                                                                                   |
| [Budidaya Ikan Lele Sistem Bioflok](https://perpustakaan.kkp.go.id/knowledgerepository/index.php?id=1072939&p=show_detail), 2018                                          | KKP-DJPB catalog says the book includes practical SOP examples for biofloc catfish, feed, water, and disease management.                                                                                                                       | The catalog labels it `Publikasi Internal`; its attachment requires library login. No downstream processing license was found. Do not use unless KKP or the rights holder supplies access and written permission.                                                                                                            |
| [Culture of Common Carp in Floating Net Cages](https://digitalarchive.worldfishcenter.org/items/aa53d705-53fd-43e8-9f34-325c4ed14420), 1989                               | WorldFish archive describes an illustrated manual based on common carp cage culture in Bandung, Indonesia. Its species and cage system must match an OpSmart farm before a rule can rely on it; its age needs a technical review.              | The archive marks it `CC BY 4.0`, the clearest reuse grant found so far. It remains a product-owner candidate, not an approved source or rule.                                                                                                                                                                               |
| [A Guide for Bighead Catfish Farming Using Better Management Practices](https://digitalarchive.worldfishcenter.org/items/dc27eaf8-f67a-4565-9559-4a8bf31f8606/full), 2023 | WorldFish describes a current, step-by-step guide for bighead catfish in Cambodia. The species and local practices may not match JagoFarm farms.                                                                                               | The archive marks it `CC-BY-NC-4.0`. The non-commercial restriction has not been shown to fit OpSmart's intended use; exclude unless the rights holder confirms permission for this use.                                                                                                                                     |     | [Petunjuk Teknis Perbibitan Ayam Kampung Unggul Balitbangtan (KUB) Terstandar](https://repository.pertanian.go.id/items/f2a80c0e-32e3-4bd5-83f1-e38d2510e1f7), 2024 | Kementan repository lists guidance on KUB breeds, housing, feed, husbandry, vaccination, health, and hatching. It only applies if the farm's chicken units are KUB; it must not be generalized to broilers or other breeds. | No per-item reuse license was shown. Kementan repository terms grant rights to the repository, not expressly to OpSmart. Not cleared. |

The owner selected an internally supplied SOP with clear usage rights as the intended
source route on 2026-10-01. The next source step is to provide the actual SOP and record
its owner and rights evidence, audience, farm/species/system applicability, version,
effective and review/expiry dates, and the rule it supports. No file is attached yet, so
the source registry stays empty and P3-04 remains abstaining. External candidates in
the table above remain research-only and are not the selected route.

## Open owner decisions blocking RAG-01 completion

1. **Hosting:** which production host/database will serve OpSmart, and does its PostgreSQL
   installation provide an approved pgvector extension? If unknown, keep the vector-store
   decision open until deployment is selected.
2. **Corpus and rights:** the intended first-source route is an internally supplied SOP
   with clear usage rights (owner decision, 2026-10-01). Still provide the specific file,
   its owner and rights evidence, intended audience (shared across farms or farm-scoped),
   applicable species/system, version/effective date, review/expiry rules, and the named
   recommendation rule. No document or corpus is approved by the source-route decision.
3. **Retention:** choose how long the source files and derived text/chunks/vectors may be
   retained, and the deletion deadline after expiry or revocation.
4. **Provider and budget:** choose local or hosted embeddings, answer-model provider if
   applicable, and the monthly cost ceiling. Hosted providers remain disabled until this
   is explicit.

Until these are resolved, RAG-02 ingestion and P3-04 activation remain gated. RAG-01
can be marked complete only after the source policy, actual environment compatibility,
provider/vector choice, retention/deletion path, and cost boundary are recorded.

## Technical references

- [pgvector project and index options](https://github.com/pgvector/pgvector/blob/master/README.md)
- [PostgreSQL 17 `CREATE EXTENSION`](https://www.postgresql.org/docs/17/sql-createextension.html)
- [Qdrant Cloud pricing](https://qdrant.tech/pricing/)
- [Qdrant multitenancy and payload filters](https://qdrant.tech/documentation/tutorials/multiple-partitions/)
- [OpenAI `text-embedding-3-small` model and price](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
