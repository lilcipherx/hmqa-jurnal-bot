import { journalRequirementConfigSchema } from '@hmqa/contracts';
import { submissionStatuses } from '@hmqa/domain';
import { translate, type TranslationKey } from '@hmqa/i18n';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../components/page-header';
import { ResourceTable } from '../../../../components/resource-table';
import { TransitionForm } from '../../../../components/transition-form';
import { DecisionForm } from '../../../../components/decision-form';
import { AssignmentForms } from '../../../../components/assignment-forms';
import { MessageForm } from '../../../../components/message-form';
import { ReviewWorkspace } from '../../../../components/review-workspace';
import { AdminApiError, adminFetch, type CurrentEmployee } from '../../../../lib/api';
import { currentLocale } from '../../../../lib/locale';

interface SubmissionDetail {
  id: string;
  publicId: string;
  status: string;
  rowVersion: number;
  submittedAt: string;
  journal: { code: string; fourEyesRequired: boolean };
  owner: {
    username: string | null;
    authorProfile: { fullName: string | null; firstName: string; lastName: string } | null;
  };
  requirementVersion: { version: number; config: unknown };
  versions: {
    versionNo: number;
    createdAt: string;
    metadata: { titles: unknown; manuscriptLanguage: string; sectionCode: string } | null;
    files: {
      category: string;
      file: {
        id: string;
        originalName: string;
        sizeBytes: string;
        sha256: string | null;
        scanStatus: string;
        storageStatus: string;
      };
    }[];
    receipts: {
      id: string;
      locale: string;
      status: string;
      readyAt: string | null;
      file: {
        id: string;
        originalName: string;
        sizeBytes: string;
        sha256: string | null;
        storageStatus: string;
      } | null;
    }[];
    preflightRuns: {
      id: string;
      fileId: string;
      status: string;
      ruleSetVersion: string;
      toolVersion: string;
      blockingCount: number;
      errorCount: number;
      warningCount: number;
      findings: unknown;
      createdAt: string;
    }[];
  }[];
  statusHistory: {
    id: string;
    fromStatus: string;
    toStatus: string;
    actorRole: string | null;
    createdAt: string;
    publicReason: string | null;
  }[];
  decisionProposals: {
    id: string;
    decision: string;
    status: string;
    publicReason: string;
    internalBasis: string;
    preparedBy: { displayName: string };
    approvedBy: { displayName: string } | null;
    createdAt: string;
  }[];
  assignments: {
    id: string;
    kind: string;
    status: string;
    deadline: string | null;
    employee: { displayName: string };
  }[];
  reviewAssignments: {
    id: string;
    status: string;
    deadline: string;
    anonymizedFileId: string;
    reviewer: { id: string; displayName: string };
    review: { recommendation: string; submittedAt: string } | null;
  }[];
  messageThread: {
    messages: {
      id: string;
      visibility: string;
      actorType: string;
      actorId: string | null;
      body: string;
      createdAt: string;
    }[];
  } | null;
}

interface AssignmentOptions {
  employees: { id: string; displayName: string }[];
  reviewers: { id: string; displayName: string; affiliation: string }[];
  files: { id: string; originalName: string }[];
}

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await currentLocale();
  const enumLabel = (namespace: string, code: string) =>
    translate(locale, `${namespace}.${code.toLowerCase()}` as TranslationKey);
  const { id } = await params;
  let data: SubmissionDetail;
  let employee: CurrentEmployee;
  try {
    [data, employee] = await Promise.all([
      adminFetch<SubmissionDetail>(`/api/v1/admin/submissions/${encodeURIComponent(id)}`),
      adminFetch<CurrentEmployee>('/api/v1/auth/me'),
    ]);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 404) notFound();
    throw error;
  }
  const latest = data.versions[0];
  const localizedTitle = (titles: unknown) => {
    if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return '';
    const values = titles as Record<string, unknown>;
    for (const key of [locale, 'ru', 'en', 'uz-Latn']) {
      const title = values[key];
      if (typeof title === 'string' && title.trim()) return title;
    }
    return '';
  };
  const articleTitle = localizedTitle(latest?.metadata?.titles);
  const authorName =
    data.owner.authorProfile?.fullName ||
    [data.owner.authorProfile?.lastName, data.owner.authorProfile?.firstName]
      .filter(Boolean)
      .join(' ') ||
    data.owner.username ||
    translate(locale, 'common.not_specified');
  const requirementConfig = journalRequirementConfigSchema.safeParse(
    data.requirementVersion.config,
  );
  const categoryLabel = (category: string) =>
    (requirementConfig.success
      ? requirementConfig.data.requiredFiles.find((policy) => policy.category === category)?.labels[
          locale
        ]
      : undefined) ?? category;
  const versionFiles = data.versions.flatMap((version) =>
    version.files.map((file) => ({ versionNo: version.versionNo, ...file })),
  );
  const receipts = data.versions.flatMap((version) =>
    version.receipts.map((receipt) => ({ versionNo: version.versionNo, ...receipt })),
  );
  const preflightRuns = data.versions.flatMap((version) =>
    version.preflightRuns.map((run) => ({ versionNo: version.versionNo, ...run })),
  );
  const findingCode = (value: unknown): string => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return '';
    const code = (value as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : '';
  };
  const findingCodes = (value: unknown): string =>
    Array.isArray(value) ? value.map(findingCode).filter(Boolean).join(', ') : '';
  const canAssignStaff = employee.permissions.includes('submission:assign');
  const canAssignReviewers = employee.permissions.includes('review:assign');
  const assignmentOptions =
    canAssignStaff || canAssignReviewers
      ? await adminFetch<AssignmentOptions>(
          `/api/v1/admin/submissions/${encodeURIComponent(id)}/assignment-options`,
        )
      : { employees: [], reviewers: [], files: [] };
  const transitionGraph: Record<string, readonly string[]> = {
    SUBMITTED: ['TECHNICAL_REVIEW', 'WITHDRAWN'],
    TECHNICAL_REVIEW: ['NEEDS_CORRECTION', 'REGISTERED', 'WITHDRAWN'],
    NEEDS_CORRECTION: ['TECHNICAL_REVIEW', 'WITHDRAWN'],
    REGISTERED: ['EDITORIAL_REVIEW', 'WITHDRAWN'],
    EDITORIAL_REVIEW: ['UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    UNDER_REVIEW: ['REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    REVISION_SUBMITTED: ['UNDER_REVIEW', 'EDITORIAL_REVIEW', 'WITHDRAWN'],
    ACCEPTED: ['COPYEDITING'],
    REJECTED: ['ARCHIVED'],
    COPYEDITING: ['LAYOUT'],
    LAYOUT: ['PUBLISHED'],
    PUBLISHED: ['ARCHIVED'],
    WITHDRAWN: ['ARCHIVED'],
  };
  const permissionForTarget = (target: string) => {
    if (['TECHNICAL_REVIEW', 'NEEDS_CORRECTION', 'REGISTERED'].includes(target))
      return 'submission:technical-review';
    if (['EDITORIAL_REVIEW', 'UNDER_REVIEW', 'REVISION_REQUESTED', 'WITHDRAWN'].includes(target))
      return 'submission:editorial-review';
    if (['ACCEPTED', 'REJECTED'].includes(target)) return 'submission:decision:approve';
    if (['COPYEDITING', 'LAYOUT', 'PUBLISHED'].includes(target)) return 'submission:publish';
    if (target === 'ARCHIVED') return 'operations:read';
    return '';
  };
  const availableTransitionStatuses = (transitionGraph[data.status] ?? []).filter((target) => {
    const permission = permissionForTarget(target);
    if (!permission || !employee.permissions.includes(permission)) return false;
    if (
      data.journal.fourEyesRequired &&
      ['ACCEPTED', 'REJECTED'].includes(target) &&
      !data.decisionProposals.some(
        (proposal) =>
          proposal.status === 'PREPARED' &&
          (proposal.decision === 'ACCEPT' ? target === 'ACCEPTED' : target === 'REJECTED'),
      )
    )
      return false;
    return true;
  });
  return (
    <>
      <PageHeader
        eyebrow={`${data.publicId} · ${data.journal.code} · v${latest?.versionNo ?? 1}`}
        title={articleTitle || data.publicId}
        description={`${authorName} · ${new Date(data.submittedAt).toLocaleString(locale)}`}
      />
      <section className="metrics">
        <article className="metric">
          <span>{translate(locale, 'admin.table.status')}</span>
          <strong className="badge">
            {translate(locale, `status.${data.status.toLowerCase()}` as TranslationKey)}
          </strong>
        </article>
        <article className="metric">
          <span>{translate(locale, 'admin.table.journal')}</span>
          <strong>{data.journal.code}</strong>
        </article>
        <article className="metric">
          <span>{translate(locale, 'admin.table.version')}</span>
          <strong>v{latest?.versionNo ?? 1}</strong>
        </article>
        <article className="metric">
          <span>{translate(locale, 'admin.table.requirements')}</span>
          <strong>v{data.requirementVersion.version}</strong>
        </article>
      </section>
      <ResourceTable
        caption={translate(locale, 'admin.section.files')}
        headers={[
          translate(locale, 'admin.table.version'),
          translate(locale, 'admin.table.category'),
          translate(locale, 'admin.table.name'),
          'SHA-256',
          translate(locale, 'admin.table.status'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={versionFiles.map((item) => [
          `v${item.versionNo}`,
          categoryLabel(item.category),
          <a className="link-button" href={`/api/files/${item.file.id}/download`}>
            {item.file.originalName}
          </a>,
          <span className="identifier">{item.file.sha256 ?? '—'}</span>,
          <span className="badge">
            {enumLabel('file_scan', item.file.scanStatus)} ·{' '}
            {enumLabel('file_storage', item.file.storageStatus)}
          </span>,
        ])}
      />
      <ResourceTable
        caption={translate(locale, 'receipt.title')}
        headers={[
          translate(locale, 'admin.table.version'),
          translate(locale, 'admin.table.locale'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.table.name'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={receipts.map((receipt) => [
          `v${receipt.versionNo}`,
          receipt.locale === 'uz_Latn' ? 'uz-Latn' : receipt.locale,
          enumLabel('receipt_status', receipt.status),
          receipt.file ? (
            <a className="link-button" href={`/api/files/${receipt.file.id}/download`}>
              {receipt.file.originalName}
            </a>
          ) : (
            '—'
          ),
        ])}
      />
      <ResourceTable
        caption={translate(locale, 'admin.preflight.heading')}
        headers={[
          translate(locale, 'admin.table.version'),
          translate(locale, 'admin.preflight.rule_set'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.preflight.counts'),
          translate(locale, 'admin.preflight.findings'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={preflightRuns.map((run) => [
          `v${run.versionNo}`,
          `${run.ruleSetVersion} · ${run.toolVersion}`,
          enumLabel('preflight_status', run.status),
          translate(locale, 'preflight.complete', {
            blocking_count: String(run.blockingCount),
            error_count: String(run.errorCount),
            warning_count: String(run.warningCount),
          }),
          <span className="identifier">{findingCodes(run.findings) || '—'}</span>,
        ])}
      />
      <ResourceTable
        caption={translate(locale, 'admin.section.status_history')}
        headers={[
          translate(locale, 'admin.table.updated'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.table.actor'),
          translate(locale, 'admin.form.public_reason'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.statusHistory.map((item) => [
          new Date(item.createdAt).toLocaleString(locale),
          `${enumLabel('status', item.fromStatus)} → ${enumLabel('status', item.toStatus)}`,
          item.actorRole
            ? enumLabel('role', item.actorRole)
            : translate(locale, 'admin.actor.system'),
          item.publicReason ?? '—',
        ])}
      />
      <ResourceTable
        caption={translate(locale, 'admin.assignments.heading')}
        headers={[
          translate(locale, 'admin.assignments.kind'),
          translate(locale, 'admin.assignments.assignee'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.form.deadline'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.assignments.map((item) => [
          enumLabel('assignment_kind', item.kind),
          item.employee.displayName,
          enumLabel('assignment_status', item.status),
          item.deadline ? new Date(item.deadline).toLocaleString(locale) : '—',
        ])}
      />
      <ResourceTable
        caption={translate(locale, 'admin.assignments.reviewers_heading')}
        headers={[
          translate(locale, 'admin.assignments.assignee'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.form.deadline'),
          translate(locale, 'admin.reviews.recommendation'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.reviewAssignments.map((item) => [
          item.reviewer.displayName,
          enumLabel('assignment_status', item.status),
          new Date(item.deadline).toLocaleString(locale),
          item.review ? enumLabel('review_recommendation', item.review.recommendation) : '—',
        ])}
      />
      {employee.permissions.includes('review:write:assigned') ? (
        <ReviewWorkspace
          items={data.reviewAssignments
            .filter((item) => item.status !== 'CANCELLED')
            .map((item) => ({
              ...item,
              submission: { publicId: data.publicId, status: data.status },
            }))}
          locale={locale}
          statusLabels={Object.fromEntries(
            ['PENDING', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED'].map((status) => [
              status,
              translate(locale, `assignment_status.${status.toLowerCase()}` as TranslationKey),
            ]),
          )}
          recommendationLabels={Object.fromEntries(
            ['ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT'].map((recommendation) => [
              recommendation,
              translate(
                locale,
                `review_recommendation.${recommendation.toLowerCase()}` as TranslationKey,
              ),
            ]),
          )}
          labels={{
            deadline: translate(locale, 'admin.form.deadline'),
            download: translate(locale, 'admin.reviews.download'),
            acceptAssignment: translate(locale, 'admin.reviews.accept_assignment'),
            declineAssignment: translate(locale, 'admin.reviews.decline_assignment'),
            recommendation: translate(locale, 'admin.reviews.recommendation'),
            accept: translate(locale, 'admin.decision.accept'),
            minorRevision: translate(locale, 'admin.reviews.minor_revision'),
            majorRevision: translate(locale, 'admin.reviews.major_revision'),
            reject: translate(locale, 'admin.decision.reject'),
            publicComments: translate(locale, 'admin.reviews.public_comments'),
            confidentialComments: translate(locale, 'admin.reviews.confidential_comments'),
            submit: translate(locale, 'admin.reviews.submit'),
            submitted: translate(locale, 'admin.reviews.submitted'),
            empty: translate(locale, 'admin.table.empty'),
          }}
        />
      ) : null}
      <ResourceTable
        caption={translate(locale, 'admin.messages.heading')}
        headers={[
          translate(locale, 'admin.table.created'),
          translate(locale, 'admin.messages.visibility'),
          translate(locale, 'admin.table.actor'),
          translate(locale, 'admin.messages.message'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={(data.messageThread?.messages ?? []).map((item) => [
          new Date(item.createdAt).toLocaleString(locale),
          enumLabel('message_visibility', item.visibility),
          enumLabel('actor_type', item.actorType),
          item.body,
        ])}
      />
      {employee.permissions.some((permission) =>
        ['submission:technical-review', 'submission:editorial-review'].includes(permission),
      ) ? (
        <MessageForm
          submissionId={data.id}
          labels={{
            heading: translate(locale, 'admin.messages.heading'),
            visibility: translate(locale, 'admin.messages.visibility'),
            public: translate(locale, 'admin.messages.public'),
            internal: translate(locale, 'admin.messages.internal'),
            message: translate(locale, 'admin.messages.message'),
            send: translate(locale, 'admin.messages.send'),
          }}
        />
      ) : null}
      {canAssignStaff || canAssignReviewers ? (
        <AssignmentForms
          submissionId={data.id}
          employees={assignmentOptions.employees}
          reviewers={assignmentOptions.reviewers}
          files={assignmentOptions.files}
          canAssignStaff={canAssignStaff}
          canAssignReviewers={canAssignReviewers}
          labels={{
            staffHeading: translate(locale, 'admin.assignments.staff_heading'),
            reviewerHeading: translate(locale, 'admin.assignments.reviewer_heading'),
            employee: translate(locale, 'admin.assignments.employee'),
            reviewer: translate(locale, 'admin.assignments.reviewer'),
            reason: translate(locale, 'admin.assignments.reason'),
            deadline: translate(locale, 'admin.form.deadline'),
            anonymizedFile: translate(locale, 'admin.assignments.anonymized_file'),
            uploadHeading: translate(locale, 'admin.assignments.upload_heading'),
            uploadHelp: translate(locale, 'admin.assignments.upload_help'),
            attestation: translate(locale, 'admin.assignments.anonymization_attestation'),
            upload: translate(locale, 'admin.assignments.upload'),
            uploadQueued: translate(locale, 'admin.assignments.upload_queued'),
            uploadValidation: translate(locale, 'admin.assignments.upload_validation'),
            assign: translate(locale, 'admin.assignments.assign'),
          }}
        />
      ) : null}
      {employee.permissions.includes('submission:decision:prepare') ? (
        <DecisionForm
          submissionId={data.id}
          labels={{
            heading: translate(locale, 'admin.decision.prepare_heading'),
            decision: translate(locale, 'admin.decision.kind'),
            accept: translate(locale, 'admin.decision.accept'),
            reject: translate(locale, 'admin.decision.reject'),
            publicReason: translate(locale, 'admin.form.public_reason'),
            internalReason: translate(locale, 'admin.form.internal_reason'),
            submit: translate(locale, 'admin.decision.prepare'),
          }}
        />
      ) : null}
      {availableTransitionStatuses.length > 0 ? (
        <TransitionForm
          submissionId={data.id}
          rowVersion={data.rowVersion}
          labels={{
            submit: translate(locale, 'admin.action.transition'),
            status: translate(locale, 'admin.form.status'),
            publicReason: translate(locale, 'admin.form.public_reason'),
            internalReason: translate(locale, 'admin.form.internal_reason'),
            deadline: translate(locale, 'admin.form.deadline'),
            publicationReference: translate(locale, 'admin.form.publication_reference'),
            decisionProposal: translate(locale, 'admin.form.decision_proposal'),
            none: translate(locale, 'admin.filter.all'),
            acceptDecision: translate(locale, 'admin.decision.accept'),
            rejectDecision: translate(locale, 'admin.decision.reject'),
          }}
          statusLabels={Object.fromEntries(
            submissionStatuses.map((status) => [
              status,
              translate(locale, `status.${status.toLowerCase()}` as TranslationKey),
            ]),
          )}
          statuses={availableTransitionStatuses}
          decisionProposals={data.decisionProposals
            .filter((proposal) => proposal.status === 'PREPARED')
            .map((proposal) => ({
              id: proposal.id,
              decision: proposal.decision,
              preparedBy: proposal.preparedBy.displayName,
            }))}
        />
      ) : null}
    </>
  );
}
