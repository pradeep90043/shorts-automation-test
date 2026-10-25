import os from "os";

export type HealthStatus = "healthy" | "degraded" | "down" | "not_configured" | "unknown";
type Check = { key:string; name:string; status:HealthStatus; severity:"info"|"warning"|"critical"; latencyMs?:number; checkedAt:string; detail:string; affected:string[]; remedy:string };

const checkedAt = () => new Date().toISOString();
async function probe(key:string,name:string,url:string|undefined,affected:string[],remedy:string):Promise<Check>{
  const at=checkedAt();
  if(!url) return {key,name,status:"not_configured",severity:"info",checkedAt:at,detail:"No probe URL configured; not monitored in this deployment.",affected:[],remedy:`No health URL is configured. ${remedy}`};
  const started=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),4500);
  try {
    const response=await fetch(url,{method:"GET",signal:controller.signal,headers:{accept:"application/json,text/plain,*/*"}});
    const latencyMs=Date.now()-started;
    if(response.status===401||response.status===403) return {key,name,status:"degraded",severity:"warning",latencyMs,checkedAt:at,detail:"Endpoint reachable but returned an authentication/authorization response.",affected,remedy:"Verify the configured endpoint and credentials in the test environment; do not paste secrets into logs."};
    if(response.status===429) return {key,name,status:"degraded",severity:"warning",latencyMs,checkedAt:at,detail:"Endpoint reachable but rate-limited (HTTP 429).",affected,remedy:"Check provider quota and rate limits; wait before retrying and use a configured fallback if available."};
    if(response.status>=500) return {key,name,status:"down",severity:"critical",latencyMs,checkedAt:at,detail:`Provider returned HTTP ${response.status}.`,affected,remedy:"Check provider status and recent logs; retry after recovery. Avoid automatically replaying publishing jobs."};
    if(!response.ok) return {key,name,status:"degraded",severity:"warning",latencyMs,checkedAt:at,detail:`Endpoint returned HTTP ${response.status}; reachability does not guarantee API functionality.`,affected,remedy:"Confirm the configured health URL is intended for a GET probe and inspect sanitized application logs."};
    return {key,name,status:"healthy",severity:"info",latencyMs,checkedAt:at,detail:"Endpoint responded successfully. This is a reachability check, not a full generation test.",affected:[],remedy:"No action required."};
  } catch(e:any) {
    return {key,name,status:"down",severity:"critical",latencyMs:Date.now()-started,checkedAt:at,detail:e?.name==="AbortError"?"Probe timed out after 4.5 seconds.":"Endpoint could not be reached.",affected,remedy:"Verify endpoint/network configuration and provider status. If this is FreeLLMAPI, use the configured fallback or local troubleshooting guidance."};
  } finally { clearTimeout(timer); }
}
export async function getPipelineHealth(){
  const checks=await Promise.all([
    probe("freellmapi","FreeLLMAPI",process.env.FREELLMAPI_HEALTH_URL||process.env.FREELLMAPI_URL||process.env.FREE_LLM_API_URL,["AI analysis","caption and metadata generation"],"Check API endpoint, key configuration, quota and rate limits; then test the configured fallback."),
    probe("gemini","Gemini",process.env.GEMINI_HEALTH_URL,["AI fallback for supported operations"],"Confirm Gemini is configured and credentials are valid; this check is skipped unless a probe URL is configured."),
    probe("kaggle","Kaggle runner",process.env.KAGGLE_HEALTH_URL,["Jobs explicitly delegated to Kaggle"],"Check the configured Kaggle runner only if this deployment uses it."),
    probe("cloudfront","CloudFront",process.env.CLOUDFRONT_HEALTH_URL,["Assets/routes served through the configured distribution"],"Verify the configured distribution and origin; unrelated pipeline features should continue."),
    probe("pexels","Pexels",process.env.PEXELS_HEALTH_URL,["Stock-footage retrieval"],"Verify Pexels configuration and quota if stock footage is enabled."),
  ]);
  const active=checks.filter(c=>c.status!=="not_configured");
  const down=active.filter(c=>c.status==="down").length;
  const degraded=active.filter(c=>c.status==="degraded").length;
  const status=down?"critical":degraded?"degraded":"healthy";
  return {status,checkedAt:checkedAt(),hostname:os.hostname(),checks,summary:{monitored:active.length,down,degraded,notConfigured:checks.length-active.length},note:"Configured endpoint reachability only; checks do not run generation, rendering, scheduling, or publishing jobs."};
}
export function getLocalRemediation(check:Check){
  return {title:`${check.name}: ${check.status.toUpperCase()}`,summary:check.detail,affected:check.affected,steps:check.remedy,source:"Local diagnostic rules",generatedAt:checkedAt()};
}
