'use client';

import { journalRequirementConfigSchema } from '@hmqa/contracts';
import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

interface JournalOption {
  id: string;
  code: string;
  mode: string;
  active: boolean;
  externalUrl: string | null;
  fourEyesRequired: boolean;
  acceptanceOpensAt: string | null;
  acceptanceClosesAt: string | null;
  updatedAt: string;
  localizations: {
    locale: string;
    name: string;
    shortName: string;
    description: string;
    contactText: string | null;
  }[];
  currentRequirement: { id: string; version: number; state: string } | null;
  requirementVersions: {
    id: string;
    version: number;
    state: string;
    rowVersion: number;
    config: unknown;
    changeNote: string;
    createdAt: string;
    localizations: {
      locale: string;
      title: string;
      summary: string;
      body: string;
      help: string | null;
      contact: string | null;
    }[];
  }[];
}

export function JournalManager({
  journals,
  labels,
  modeLabels,
  stateLabels,
}: {
  journals: JournalOption[];
  labels: Record<string, string>;
  modeLabels: Record<string, string>;
  stateLabels: Record<string, string>;
}) {
  const [showCreateJournal, setShowCreateJournal] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setMessage('');
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy(false);
    }
  }
  async function createJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localized = (suffix: string) => ({
      name: form.get(`name_${suffix}`),
      shortName: form.get(`short_${suffix}`),
      description: form.get(`description_${suffix}`),
      contactText: form.get(`contact_${suffix}`) || undefined,
    });
    await send('/api/journals', {
      code: form.get('code'),
      mode: form.get('mode'),
      externalUrl: form.get('externalUrl') || undefined,
      active: form.get('active') === 'on',
      fourEyesRequired: form.get('fourEyesRequired') === 'on',
      acceptanceOpensAt: text(form, 'acceptanceOpensAt')
        ? new Date(text(form, 'acceptanceOpensAt')).toISOString()
        : undefined,
      acceptanceClosesAt: text(form, 'acceptanceClosesAt')
        ? new Date(text(form, 'acceptanceClosesAt')).toISOString()
        : undefined,
      localizations: { 'uz-Latn': localized('uz'), ru: localized('ru'), en: localized('en') },
    });
  }
  async function createRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const maxBytes = Number(form.get('maxMiB')) * 1024 * 1024;
    const reviewModel = text(form, 'reviewModel');
    const requiredReviewerCount =
      reviewModel === 'NO_EXTERNAL_REVIEW' ? 0 : Number(form.get('reviewerCount'));
    const requiredFiles = [
      {
        category: 'MANUSCRIPT',
        labels: {
          'uz-Latn': text(form, 'manuscriptLabelUz'),
          ru: text(form, 'manuscriptLabelRu'),
          en: text(form, 'manuscriptLabelEn'),
        },
        formats: form.get('allowManuscriptPdf') === 'on' ? ['docx', 'pdf'] : ['docx'],
        required: true,
        preflightRequired: true,
      },
      ...(form.get('includeSupplement') === 'on'
        ? [
            {
              category: 'SUPPLEMENT',
              labels: {
                'uz-Latn': text(form, 'supplementLabelUz'),
                ru: text(form, 'supplementLabelRu'),
                en: text(form, 'supplementLabelEn'),
              },
              formats: ['docx', 'pdf'],
              required: form.get('supplementRequired') === 'on',
              preflightRequired: false,
            },
          ]
        : []),
    ];
    const config = {
      requiredFiles,
      limits: { maxBytes, maxFiles: 10, maxTotalBytes: 50 * 1024 * 1024 },
      metadata: {
        abstractMinWords: Number(form.get('abstractMin')),
        abstractMaxWords: Number(form.get('abstractMax')),
        keywordMinCount: Number(form.get('keywordMin')),
        keywordMaxCount: Number(form.get('keywordMax')),
        coauthorMaxCount: Number(form.get('coauthorMax')),
      },
      preflight: { docx: { rulesVersion: 'admin-structured-v1', requiredMarkers: [] } },
      workflow: {
        reviewModel,
        requiredReviewerCount,
        decisionRequiresCompletedReviews: requiredReviewerCount > 0,
      },
    };
    const localized = (suffix: string) => ({
      title: form.get(`title_${suffix}`),
      summary: form.get(`summary_${suffix}`),
      body: form.get(`body_${suffix}`),
      help: form.get(`help_${suffix}`) || undefined,
      contact: form.get(`requirement_contact_${suffix}`) || undefined,
    });
    await send(`/api/journals/${text(form, 'journalId')}/requirements`, {
      config,
      changeNote: form.get('changeNote'),
      localizations: { 'uz-Latn': localized('uz'), ru: localized('ru'), en: localized('en') },
    });
  }
  async function updateRequirement(
    event: FormEvent<HTMLFormElement>,
    requirement: JournalOption['requirementVersions'][number],
  ) {
    event.preventDefault();
    const parsed = journalRequirementConfigSchema.safeParse(requirement.config);
    if (!parsed.success) {
      setMessage(labels.invalidConfig ?? '');
      return;
    }
    const form = new FormData(event.currentTarget);
    const reviewModel = text(form, 'editRequirementReviewModel');
    const reviewerCount =
      reviewModel === 'NO_EXTERNAL_REVIEW' ? 0 : Number(form.get('editRequirementReviewerCount'));
    const config = {
      ...parsed.data,
      requiredFiles: parsed.data.requiredFiles.map((file) =>
        file.category === 'MANUSCRIPT'
          ? {
              ...file,
              formats:
                form.get('editRequirementAllowPdf') === 'on'
                  ? (['docx', 'pdf'] as const)
                  : (['docx'] as const),
            }
          : file,
      ),
      limits: {
        ...parsed.data.limits,
        maxBytes: Number(form.get('editRequirementMaxMiB')) * 1024 * 1024,
      },
      metadata: {
        ...parsed.data.metadata,
        abstractMinWords: Number(form.get('editRequirementAbstractMin')),
        abstractMaxWords: Number(form.get('editRequirementAbstractMax')),
        keywordMinCount: Number(form.get('editRequirementKeywordMin')),
        keywordMaxCount: Number(form.get('editRequirementKeywordMax')),
        coauthorMaxCount: Number(form.get('editRequirementCoauthorMax')),
      },
      workflow: {
        ...parsed.data.workflow,
        reviewModel,
        requiredReviewerCount: reviewerCount,
        decisionRequiresCompletedReviews: reviewerCount > 0,
      },
    };
    const localized = (suffix: string) => ({
      title: form.get(`edit_requirement_title_${suffix}`),
      summary: form.get(`edit_requirement_summary_${suffix}`),
      body: form.get(`edit_requirement_body_${suffix}`),
      help: form.get(`edit_requirement_help_${suffix}`) || null,
      contact: form.get(`edit_requirement_contact_${suffix}`) || null,
    });
    await send(
      `/api/requirements/${requirement.id}`,
      {
        config,
        changeNote: form.get('editRequirementChangeNote'),
        localizations: {
          'uz-Latn': localized('uz'),
          ru: localized('ru'),
          en: localized('en'),
        },
        expectedRowVersion: requirement.rowVersion,
      },
      'PATCH',
    );
  }
  async function updateJournal(event: FormEvent<HTMLFormElement>, journal: JournalOption) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localized = (suffix: string) => ({
      name: form.get(`edit_name_${suffix}`),
      shortName: form.get(`edit_short_${suffix}`),
      description: form.get(`edit_description_${suffix}`),
      contactText: form.get(`edit_contact_${suffix}`) || null,
    });
    await send(
      `/api/journals/${journal.id}`,
      {
        mode: form.get('edit_mode'),
        externalUrl: form.get('edit_external_url') || null,
        active: form.get('edit_active') === 'on',
        fourEyesRequired: form.get('edit_four_eyes') === 'on',
        acceptanceOpensAt: text(form, 'edit_acceptance_opens')
          ? new Date(text(form, 'edit_acceptance_opens')).toISOString()
          : null,
        acceptanceClosesAt: text(form, 'edit_acceptance_closes')
          ? new Date(text(form, 'edit_acceptance_closes')).toISOString()
          : null,
        localizations: {
          'uz-Latn': localized('uz'),
          ru: localized('ru'),
          en: localized('en'),
        },
        expectedUpdatedAt: journal.updatedAt,
      },
      'PATCH',
    );
  }
  const next: Record<string, string> = {
    DRAFT: 'REVIEW',
    REVIEW: 'APPROVED',
    APPROVED: 'PUBLISHED',
    PUBLISHED: 'RETIRED',
  };
  return (
    <div className="form-grid">
      <div className="button-row full-width">
        <button
          className="button"
          type="button"
          data-testid="add-journal"
          aria-expanded={showCreateJournal}
          onClick={() => setShowCreateJournal((current) => !current)}
        >
          {labels.createJournal}
        </button>
      </div>
      {showCreateJournal ? (
        <form
          className="panel form-stack journal-create-form"
          data-testid="create-journal"
          onSubmit={(event) => void createJournal(event)}
          aria-busy={busy}
        >
          <h2>{labels.createJournal}</h2>
          <fieldset className="localized-fields">
            <legend>{labels.basicInfo}</legend>
            <label className="field">
              {labels.code}
              <input name="code" pattern="[A-Za-z0-9_-]{2,16}" required />
            </label>
            <label className="field">
              {labels.mode}
              <select name="mode">
                {['NATIVE', 'CLOSED', 'EXTERNAL_LINK', 'API_SYNC'].map((mode) => (
                  <option key={mode} value={mode}>
                    {modeLabels[mode] ?? mode}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {labels.externalUrl}
              <input name="externalUrl" type="url" />
            </label>
          </fieldset>
          <fieldset className="localized-fields">
            <legend>{labels.localizedContent}</legend>
            {['uz', 'ru', 'en'].map((suffix) => (
              <fieldset className="field" key={suffix}>
                <legend>{suffix.toUpperCase()}</legend>
                <input name={`name_${suffix}`} placeholder={labels.name} required />
                <input name={`short_${suffix}`} placeholder={labels.shortName} required />
                <textarea
                  name={`description_${suffix}`}
                  placeholder={labels.description}
                  required
                />
                <textarea name={`contact_${suffix}`} placeholder={labels.contact} />
              </fieldset>
            ))}
          </fieldset>
          <fieldset className="localized-fields">
            <legend>{labels.submissionSettings}</legend>
            <label className="check-row">
              <input name="active" type="checkbox" defaultChecked /> {labels.active}
            </label>
            <label className="check-row">
              <input name="fourEyesRequired" type="checkbox" defaultChecked /> {labels.fourEyes}
            </label>
          </fieldset>
          <fieldset className="localized-fields">
            <legend>{labels.datesAndDeadlines}</legend>
            <label className="field">
              {labels.acceptanceOpens}
              <input name="acceptanceOpensAt" type="datetime-local" />
            </label>
            <label className="field">
              {labels.acceptanceCloses}
              <input name="acceptanceClosesAt" type="datetime-local" />
            </label>
          </fieldset>
          <button className="button" type="submit" disabled={busy}>
            {labels.create}
          </button>
        </form>
      ) : null}
      <form
        className="panel form-stack"
        data-testid="create-requirement"
        onSubmit={(event) => void createRequirement(event)}
        aria-busy={busy}
      >
        <h2>{labels.createRequirement}</h2>
        <label className="field">
          {labels.journal}
          <select name="journalId" required>
            {journals.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {labels.changeNote}
          <textarea name="changeNote" required />
        </label>
        <fieldset className="localized-fields">
          <legend>{labels.files}</legend>
          <div className="form-grid compact">
            <label className="field">
              UZ
              <input name="manuscriptLabelUz" defaultValue="Asosiy maqola" required />
            </label>
            <label className="field">
              RU
              <input name="manuscriptLabelRu" defaultValue="Основная статья" required />
            </label>
            <label className="field">
              EN
              <input name="manuscriptLabelEn" defaultValue="Main manuscript" required />
            </label>
          </div>
          <label className="check-row">
            <input name="allowManuscriptPdf" type="checkbox" /> {labels.allowPdf}
          </label>
          <label className="check-row">
            <input name="includeSupplement" type="checkbox" /> {labels.includeSupplement}
          </label>
          <div className="form-grid compact">
            <label className="field">
              UZ
              <input name="supplementLabelUz" defaultValue="Qo‘shimcha fayl" />
            </label>
            <label className="field">
              RU
              <input name="supplementLabelRu" defaultValue="Дополнительный файл" />
            </label>
            <label className="field">
              EN
              <input name="supplementLabelEn" defaultValue="Supplementary file" />
            </label>
          </div>
          <label className="check-row">
            <input name="supplementRequired" type="checkbox" /> {labels.supplementRequired}
          </label>
        </fieldset>
        <fieldset className="localized-fields">
          <legend>{labels.limits}</legend>
          <div className="form-grid compact">
            <label className="field">
              {labels.maxMiB}
              <input name="maxMiB" type="number" min="1" max="19" defaultValue="19" required />
            </label>
            <label className="field">
              {labels.abstractMin}
              <input
                name="abstractMin"
                type="number"
                min="1"
                max="5000"
                defaultValue="150"
                required
              />
            </label>
            <label className="field">
              {labels.abstractMax}
              <input
                name="abstractMax"
                type="number"
                min="1"
                max="5000"
                defaultValue="300"
                required
              />
            </label>
            <label className="field">
              {labels.keywordMin}
              <input name="keywordMin" type="number" min="1" max="100" defaultValue="5" required />
            </label>
            <label className="field">
              {labels.keywordMax}
              <input name="keywordMax" type="number" min="1" max="100" defaultValue="10" required />
            </label>
            <label className="field">
              {labels.coauthorMax}
              <input
                name="coauthorMax"
                type="number"
                min="0"
                max="100"
                defaultValue="10"
                required
              />
            </label>
          </div>
        </fieldset>
        <fieldset className="localized-fields">
          <legend>{labels.workflow}</legend>
          <label className="field">
            {labels.reviewModel}
            <select name="reviewModel" defaultValue="NO_EXTERNAL_REVIEW">
              <option value="NO_EXTERNAL_REVIEW">{labels.noExternalReview}</option>
              <option value="SINGLE_BLIND">{labels.singleBlind}</option>
              <option value="DOUBLE_BLIND">{labels.doubleBlind}</option>
            </select>
          </label>
          <label className="field">
            {labels.reviewerCount}
            <input name="reviewerCount" type="number" min="1" max="10" defaultValue="2" required />
          </label>
        </fieldset>
        {['uz', 'ru', 'en'].map((suffix) => (
          <fieldset className="field" key={suffix}>
            <legend>{suffix.toUpperCase()}</legend>
            <input name={`title_${suffix}`} placeholder={labels.title} required />
            <textarea name={`summary_${suffix}`} placeholder={labels.summary} required />
            <textarea name={`body_${suffix}`} placeholder={labels.body} rows={4} required />
            <textarea name={`help_${suffix}`} placeholder={labels.help} />
            <textarea name={`requirement_contact_${suffix}`} placeholder={labels.contact} />
          </fieldset>
        ))}
        <button className="button" type="submit" disabled={busy}>
          {labels.create}
        </button>
      </form>
      {journals.map((journal) => {
        const localization = (locale: string) =>
          journal.localizations.find((entry) => entry.locale === locale);
        const localDate = (value: string | null) =>
          value ? new Date(value).toISOString().slice(0, 16) : '';
        return (
          <details
            className="panel"
            data-testid={`edit-journal-${journal.id}`}
            key={`edit-${journal.id}`}
          >
            <summary>
              {labels.editJournal}: {journal.code}
            </summary>
            <form
              className="form-stack"
              onSubmit={(event) => void updateJournal(event, journal)}
              aria-busy={busy}
            >
              <label className="field">
                {labels.mode}
                <select name="edit_mode" defaultValue={journal.mode}>
                  {['NATIVE', 'CLOSED', 'EXTERNAL_LINK', 'API_SYNC', 'ARCHIVED'].map((mode) => (
                    <option key={mode} value={mode}>
                      {modeLabels[mode] ?? mode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {labels.externalUrl}
                <input
                  name="edit_external_url"
                  type="url"
                  defaultValue={journal.externalUrl ?? ''}
                />
              </label>
              <div className="form-grid compact">
                <label className="field">
                  {labels.acceptanceOpens}
                  <input
                    name="edit_acceptance_opens"
                    type="datetime-local"
                    defaultValue={localDate(journal.acceptanceOpensAt)}
                  />
                </label>
                <label className="field">
                  {labels.acceptanceCloses}
                  <input
                    name="edit_acceptance_closes"
                    type="datetime-local"
                    defaultValue={localDate(journal.acceptanceClosesAt)}
                  />
                </label>
              </div>
              <label className="check-row">
                <input name="edit_active" type="checkbox" defaultChecked={journal.active} />{' '}
                {labels.active}
              </label>
              <label className="check-row">
                <input
                  name="edit_four_eyes"
                  type="checkbox"
                  defaultChecked={journal.fourEyesRequired}
                />{' '}
                {labels.fourEyes}
              </label>
              {[
                ['uz', 'uz_Latn'],
                ['ru', 'ru'],
                ['en', 'en'],
              ].map(([suffix, locale]) => {
                const value = localization(locale!);
                return (
                  <fieldset className="field" key={`${journal.id}-${locale}`}>
                    <legend>{suffix!.toUpperCase()}</legend>
                    <input
                      name={`edit_name_${suffix}`}
                      defaultValue={value?.name ?? ''}
                      placeholder={labels.name}
                      required
                    />
                    <input
                      name={`edit_short_${suffix}`}
                      defaultValue={value?.shortName ?? ''}
                      placeholder={labels.shortName}
                      required
                    />
                    <textarea
                      name={`edit_description_${suffix}`}
                      defaultValue={value?.description ?? ''}
                      placeholder={labels.description}
                      required
                    />
                    <textarea
                      name={`edit_contact_${suffix}`}
                      defaultValue={value?.contactText ?? ''}
                      placeholder={labels.contact}
                    />
                  </fieldset>
                );
              })}
              <button className="button" type="submit" disabled={busy}>
                {labels.save}
              </button>
            </form>
          </details>
        );
      })}
      <section className="panel form-stack">
        <h2>{labels.lifecycle}</h2>
        {journals.map((journal) => (
          <div className="button-row" key={`journal-${journal.id}`}>
            <span className="identifier">
              {journal.code} · {modeLabels[journal.mode] ?? journal.mode}
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void send(
                  `/api/journals/${journal.id}`,
                  {
                    mode: journal.mode === 'NATIVE' ? 'CLOSED' : 'NATIVE',
                    expectedUpdatedAt: journal.updatedAt,
                  },
                  'PATCH',
                )
              }
            >
              {journal.mode === 'NATIVE' ? labels.close : labels.open}
            </button>
          </div>
        ))}
      </section>
      <section className="panel requirement-history">
        <h2>{labels.requirementHistory}</h2>
        {journals.flatMap((journal) =>
          journal.requirementVersions.map((version) => {
            const parsed = journalRequirementConfigSchema.safeParse(version.config);
            const manuscript = parsed.success
              ? parsed.data.requiredFiles.find((file) => file.category === 'MANUSCRIPT')
              : undefined;
            const localization = (locale: string) =>
              version.localizations.find((entry) => entry.locale === locale);
            const isActive = journal.currentRequirement?.id === version.id;
            return (
              <details
                key={version.id}
                className="requirement-version"
                data-testid={`requirement-version-${version.id}`}
              >
                <summary>
                  <span className="identifier">
                    {journal.code} · v{version.version}
                  </span>{' '}
                  · {stateLabels[version.state] ?? version.state}
                  {isActive ? ` · ${labels.activeRequirement}` : ''}
                </summary>
                <div className="requirement-version-content">
                  <p className="lede requirement-note">
                    {version.changeNote} · {new Date(version.createdAt).toLocaleString()}
                  </p>
                  <h3>{labels.requirementPreview}</h3>
                  <div className="form-grid compact">
                    {[
                      ['UZ', 'uz_Latn'],
                      ['RU', 'ru'],
                      ['EN', 'en'],
                    ].map(([label, locale]) => {
                      const value = localization(locale!);
                      return (
                        <section className="notice requirement-preview" key={locale}>
                          <strong>{label}</strong>
                          <span>{value?.title ?? '—'}</span>
                          <p>{value?.summary ?? '—'}</p>
                          <p className="pre-wrap">{value?.body ?? '—'}</p>
                          {value?.help ? (
                            <p>
                              <strong>{labels.help}:</strong> {value.help}
                            </p>
                          ) : null}
                          {value?.contact ? (
                            <p>
                              <strong>{labels.contact}:</strong> {value.contact}
                            </p>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                  {parsed.success ? (
                    <div className="notice requirement-policy-summary">
                      <span>
                        {labels.maxMiB}: {Math.floor(parsed.data.limits.maxBytes / 1024 / 1024)}
                      </span>
                      <span>
                        {labels.reviewModel}:{' '}
                        {parsed.data.workflow.reviewModel === 'NO_EXTERNAL_REVIEW'
                          ? labels.noExternalReview
                          : parsed.data.workflow.reviewModel === 'SINGLE_BLIND'
                            ? labels.singleBlind
                            : labels.doubleBlind}
                      </span>
                      <span>
                        {labels.reviewerCount}: {parsed.data.workflow.requiredReviewerCount}
                      </span>
                    </div>
                  ) : (
                    <p className="error">{labels.invalidConfig}</p>
                  )}
                  {version.state === 'DRAFT' && parsed.success ? (
                    <details className="requirement-editor-shell">
                      <summary>{labels.editRequirement}</summary>
                      <form
                        className="form-stack requirement-editor"
                        data-testid={`edit-requirement-${version.id}`}
                        onSubmit={(event) => void updateRequirement(event, version)}
                        aria-busy={busy}
                      >
                        <label className="field">
                          {labels.changeNote}
                          <textarea
                            name="editRequirementChangeNote"
                            defaultValue={version.changeNote}
                            required
                          />
                        </label>
                        <fieldset className="localized-fields">
                          <legend>{labels.limits}</legend>
                          <div className="form-grid compact">
                            <label className="field">
                              {labels.maxMiB}
                              <input
                                name="editRequirementMaxMiB"
                                type="number"
                                min="1"
                                max="19"
                                defaultValue={Math.floor(parsed.data.limits.maxBytes / 1024 / 1024)}
                                required
                              />
                            </label>
                            <label className="field">
                              {labels.abstractMin}
                              <input
                                name="editRequirementAbstractMin"
                                type="number"
                                min="1"
                                max="5000"
                                defaultValue={parsed.data.metadata.abstractMinWords}
                                required
                              />
                            </label>
                            <label className="field">
                              {labels.abstractMax}
                              <input
                                name="editRequirementAbstractMax"
                                type="number"
                                min="1"
                                max="5000"
                                defaultValue={parsed.data.metadata.abstractMaxWords}
                                required
                              />
                            </label>
                            <label className="field">
                              {labels.keywordMin}
                              <input
                                name="editRequirementKeywordMin"
                                type="number"
                                min="1"
                                max="100"
                                defaultValue={parsed.data.metadata.keywordMinCount}
                                required
                              />
                            </label>
                            <label className="field">
                              {labels.keywordMax}
                              <input
                                name="editRequirementKeywordMax"
                                type="number"
                                min="1"
                                max="100"
                                defaultValue={parsed.data.metadata.keywordMaxCount}
                                required
                              />
                            </label>
                            <label className="field">
                              {labels.coauthorMax}
                              <input
                                name="editRequirementCoauthorMax"
                                type="number"
                                min="0"
                                max="100"
                                defaultValue={parsed.data.metadata.coauthorMaxCount}
                                required
                              />
                            </label>
                          </div>
                        </fieldset>
                        <fieldset className="localized-fields">
                          <legend>{labels.files}</legend>
                          <label className="check-row">
                            <input
                              name="editRequirementAllowPdf"
                              type="checkbox"
                              defaultChecked={manuscript?.formats.includes('pdf') ?? false}
                            />{' '}
                            {labels.allowPdf}
                          </label>
                        </fieldset>
                        <fieldset className="localized-fields">
                          <legend>{labels.workflow}</legend>
                          <label className="field">
                            {labels.reviewModel}
                            <select
                              name="editRequirementReviewModel"
                              defaultValue={parsed.data.workflow.reviewModel}
                            >
                              <option value="NO_EXTERNAL_REVIEW">{labels.noExternalReview}</option>
                              <option value="SINGLE_BLIND">{labels.singleBlind}</option>
                              <option value="DOUBLE_BLIND">{labels.doubleBlind}</option>
                            </select>
                          </label>
                          <label className="field">
                            {labels.reviewerCount}
                            <input
                              name="editRequirementReviewerCount"
                              type="number"
                              min="1"
                              max="10"
                              defaultValue={Math.max(1, parsed.data.workflow.requiredReviewerCount)}
                              required
                            />
                          </label>
                        </fieldset>
                        {[
                          ['uz', 'uz_Latn'],
                          ['ru', 'ru'],
                          ['en', 'en'],
                        ].map(([suffix, locale]) => {
                          const value = localization(locale!);
                          return (
                            <fieldset className="localized-fields" key={locale}>
                              <legend>{suffix!.toUpperCase()}</legend>
                              <label className="field">
                                {labels.title}
                                <input
                                  name={`edit_requirement_title_${suffix}`}
                                  defaultValue={value?.title ?? ''}
                                  required
                                />
                              </label>
                              <label className="field">
                                {labels.summary}
                                <textarea
                                  name={`edit_requirement_summary_${suffix}`}
                                  defaultValue={value?.summary ?? ''}
                                  required
                                />
                              </label>
                              <label className="field">
                                {labels.body}
                                <textarea
                                  name={`edit_requirement_body_${suffix}`}
                                  defaultValue={value?.body ?? ''}
                                  required
                                />
                              </label>
                              <label className="field">
                                {labels.help}
                                <textarea
                                  name={`edit_requirement_help_${suffix}`}
                                  defaultValue={value?.help ?? ''}
                                />
                              </label>
                              <label className="field">
                                {labels.contact}
                                <textarea
                                  name={`edit_requirement_contact_${suffix}`}
                                  defaultValue={value?.contact ?? ''}
                                />
                              </label>
                            </fieldset>
                          );
                        })}
                        <button className="button" type="submit" disabled={busy}>
                          {labels.save}
                        </button>
                      </form>
                    </details>
                  ) : null}
                  {next[version.state] ? (
                    <div className="button-row">
                      {version.state === 'REVIEW' ? (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            void send(`/api/requirements/${version.id}/state`, {
                              targetState: 'DRAFT',
                              expectedRowVersion: version.rowVersion,
                            })
                          }
                        >
                          {labels.returnDraft}
                        </button>
                      ) : null}
                      <button
                        className="button secondary"
                        disabled={busy || !parsed.success}
                        onClick={() =>
                          void send(`/api/requirements/${version.id}/state`, {
                            targetState: next[version.state],
                            expectedRowVersion: version.rowVersion,
                          })
                        }
                      >
                        {labels.advance}: {stateLabels[next[version.state]!] ?? next[version.state]}
                      </button>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          }),
        )}
        {journals.every((journal) => journal.requirementVersions.length === 0) ? (
          <p>{labels.noRequirements}</p>
        ) : null}
      </section>
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
    </div>
  );
}
