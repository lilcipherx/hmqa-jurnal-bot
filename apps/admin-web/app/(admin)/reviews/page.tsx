import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ReviewWorkspace } from '../../../components/review-workspace';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

interface Assignment {
  id: string;
  status: string;
  deadline: string;
  anonymizedFileId: string;
  submission: { publicId: string; status: string };
  review: { recommendation: string; submittedAt: string } | null;
}

export default async function ReviewsPage() {
  const locale = await currentLocale();
  const data = await adminFetch<{ items: Assignment[] }>('/api/v1/admin/reviews/assigned');
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.reviews.heading')}
        description={translate(locale, 'admin.reviews.description')}
      />
      <ReviewWorkspace
        items={data.items}
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
    </>
  );
}
