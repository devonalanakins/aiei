// Advisory-only projection of a read-only GitHub snapshot.
// This does not authenticate the snapshot producer or authorize any release.
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function advisoryPilotReport(snapshot) {
  const checks = Array.isArray(snapshot?.check_runs) ? snapshot.check_runs : null;
  const workflows = Array.isArray(snapshot?.workflow_runs) ? snapshot.workflow_runs : null;
  const statuses = Array.isArray(snapshot?.commit_status?.statuses) ? snapshot.commit_status.statuses : null;
  const summary = snapshot?.summary;
  const head = snapshot?.head_sha;
  const observed = (checks?.length ?? 0) + (workflows?.length ?? 0) + (statuses?.length ?? 0);
  const identityOK = typeof snapshot?.repository === 'string' && REPO.test(snapshot.repository) &&
    Number.isSafeInteger(snapshot.number) && snapshot.number > 0 &&
    typeof head === 'string' && SHA.test(head) &&
    typeof snapshot.base_sha === 'string' && SHA.test(snapshot.base_sha) &&
    snapshot.source === 'github_rest_read_only' && snapshot.github_metadata_observed === true;
  const countsOK = checks !== null && workflows !== null && statuses !== null &&
    summary?.check_runs?.observed === checks.length &&
    summary?.workflow_runs?.observed === workflows.length &&
    summary?.commit_status_count === statuses.length;
  const complete = identityOK && countsOK && summary?.collection_complete === true &&
    typeof summary?.all_observed_checks_successful === 'boolean';
  const runsClean = [...(checks ?? []), ...(workflows ?? [])].every(run =>
    run && run.sha === head && run.status === 'completed' && run.conclusion === 'success');
  const statusesClean = (statuses ?? []).every(status => status && status.state === 'success') &&
    (statuses?.length ? snapshot.commit_status.combined_state === 'success' : true);
  const clean = complete && observed > 0 && runsClean && statusesClean &&
    summary.all_observed_checks_successful === true;

  const observation = !complete ? 'INCOMPLETE' : observed === 0 ? 'NO_EVIDENCE' :
    clean ? 'OBSERVED_SUCCESS_ONLY' : 'OBSERVED_NOT_ALL_SUCCESSFUL';
  return {
    schema_version: 'merit.github.advisory-pilot.v1',
    repository: identityOK ? snapshot.repository : null,
    pr_number: identityOK ? snapshot.number : null,
    head_sha: identityOK ? head : null,
    observation,
    observed_counts: {
      check_runs: checks?.length ?? null,
      workflow_runs: workflows?.length ?? null,
      commit_statuses: statuses?.length ?? null,
    },
    collection_complete: complete,
    github_metadata_reported: snapshot?.github_metadata_observed === true,
    policy_required_checks_verified: false,
    witness_provenance_authenticated: false,
    tests_independently_reproduced: false,
    human_approvals_verified: false,
    production_verified: false,
    release_authorized: false,
    limitations: [
      'Caller-supplied GitHub metadata is not independently authenticated by this report.',
      'Observed success is not proof of required-check selection, test meaning, or production behavior.',
      'Only an authorized human and the deployment owner can approve release.',
    ],
  };
}
