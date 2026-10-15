import { Helmet } from '@dr.pogodin/react-helmet';

// This component is deliberately not registered as a route while employee self-service is disabled.
export default function DisabledEmployeeSelfService() {
  return <><Helmet><title>Employee self-service unavailable | Connection Pilot</title><meta name="description" content="Employee self-service is not enabled for this workspace." /><meta name="robots" content="noindex,nofollow" /></Helmet><main><h1>Employee self-service unavailable</h1></main></>;
}
