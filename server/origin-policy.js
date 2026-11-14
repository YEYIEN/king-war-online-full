/**
 * Optional deployment allowlist. Use exact scheme/host/port origins, never a
 * wildcard subdomain matcher. The default is deliberately backward-compatible
 * for local development; production should configure KW_ALLOWED_ORIGINS.
 */
export function originPolicy(raw=process.env.KW_ALLOWED_ORIGINS) {
 const origins=(raw||"").split(",").map(s=>s.trim()).filter(Boolean);
 for(const origin of origins) {
  try {
   const u=new URL(origin);
   if(!["http:","https:"].includes(u.protocol) || u.origin!==origin || u.pathname!=="/")
     throw new Error("Invalid origin");
  }catch{throw new Error("KW_ALLOWED_ORIGINS must contain exact HTTP(S) origins");}
 }
 const allowed=new Set(origins);
 return {
  active:allowed.size>0,
  corsOrigins:origins.length?origins:"*",
  allowRequest(req,done){
   if(!allowed.size)return done(null,true);
   const source=req.headers?.origin;
   done(null,typeof source==="string" && allowed.has(source));
  }
 };
}
