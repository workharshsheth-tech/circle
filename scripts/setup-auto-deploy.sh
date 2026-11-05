#!/usr/bin/env bash
# One-time: let GitHub (only the workharshsheth-tech/circle repo) deploy Circle, without any key.
# Run in Google Cloud Shell, signed in as work.harshsheth@gmail.com.
set -euo pipefail
P=circle-88f2b
REPO=workharshsheth-tech/circle
SA=circle-deploy@$P.iam.gserviceaccount.com
gcloud config set project $P
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || gcloud iam service-accounts create circle-deploy --display-name="Circle deploy from GitHub"
for r in roles/firebasehosting.admin roles/firebaserules.admin roles/firebase.viewer roles/datastore.viewer roles/serviceusage.serviceUsageConsumer roles/serviceusage.serviceUsageViewer; do
  gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=$r --condition=None -q >/dev/null
done
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --display-name="GitHub Actions" --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
    --attribute-condition="assertion.repository=='$REPO'"
NUM=$(gcloud projects describe $P --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" -q >/dev/null
echo
echo "DONE. Project number: $NUM. GitHub can now deploy Circle."
