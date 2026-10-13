/**
 * A realistic "Monday morning" for a manager running three brands, with the
 * kinds of trouble a real week produces. Used to walk the dashboard as a user.
 * Run against a scratch database only:
 *   DATABASE_URL=postgres://.../ggsocial_walk node scripts/seed-walkthrough.mjs
 */
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const id = () => nanoid(16);
const H = 3600_000, D = 24 * H;
const at = (hoursFromNow) => new Date(Date.now() + hoursFromNow * H);
const j = (v) => sql.json(v);

await sql`truncate users cascade`;
const uid = id();
await sql`insert into users (id,email,name,password_hash) values (${uid},'manager@ggsocial.test','Sam Manager',${await bcrypt.hash("walkthrough1", 10)})`;

const BRANDS = [
  { n: "Harbour Coffee", c: "#f97316", ch: [["instagram","@harbourcoffee","live","connected"],["facebook","Harbour Coffee","live","connected"],["tiktok","@harbourcoffee","manual","connected"]] },
  { n: "Acme Robotics", c: "#6366f1", ch: [["linkedin","Acme Robotics","live","expired"],["x","@acmerobotics","live","connected"],["youtube","Acme Robotics","manual","connected"]] },
  { n: "Northwind Legal", c: "#0ea5e9", ch: [["linkedin","Northwind Legal","live","connected"],["x","@northwindlegal","live","error"]] },
];
const B = {};
for (const b of BRANDS) {
  const bid = id();
  B[b.n] = { id: bid, ch: {} };
  await sql`insert into brands (id,name,slug,color,timezone) values (${bid},${b.n},${b.n.toLowerCase().replace(/\W+/g,"-")},${b.c},'Europe/London')`;
  await sql`insert into memberships (id,user_id,brand_id,role) values (${id()},${uid},${bid},'owner')`;
  for (const [p, h, mode, status] of b.ch) {
    const cid = id();
    B[b.n].ch[p] = cid;
    await sql`insert into channels (id,brand_id,platform,handle,mode,status,last_error,token_expires_at)
      values (${cid},${bid},${p},${h},${mode},${status},
        ${status==="error" ? "Rate limit exceeded; X rejected the last 3 requests (401 Unauthorized)" : null},
        ${status==="expired" ? at(-30) : null})`;
  }
}

async function post(brand, title, body, status, hours, targets, extra = {}) {
  const pid = id();
  const b = B[brand];
  await sql`insert into posts (id,brand_id,title,body,status,scheduled_at,published_at,agent_code,created_by)
    values (${pid},${b.id},${title},${body},${status},${hours===null?null:at(hours)},${status==="published"?at(hours):null},${extra.agent??null},${uid})`;
  for (const [plat, tstatus, err] of targets) {
    await sql`insert into post_targets (id,post_id,channel_id,status,scheduled_at,published_at,last_error,attempts)
      values (${id()},${pid},${b.ch[plat]},${tstatus},${hours===null?null:at(hours)},${tstatus==="published"?at(hours):null},${err??null},${err?3:0})`;
  }
  return pid;
}

// Published earlier this week (some channels silent)
await post("Harbour Coffee","Ethiopian Guji landed","Blueberry, jasmine, a bit of a show-off.","published",-30,[["instagram","published"],["facebook","published"]],{agent:"writer"});
await post("Harbour Coffee","Saturday hours","Open 8-4 all winter.","published",-80,[["instagram","published"],["facebook","published"]]);
await post("Acme Robotics","Series A story","We raised $12M.","published",-120,[["x","published"]]);
// Scheduled soon
await post("Harbour Coffee","Latte art Friday","Show us yours.","scheduled",5,[["instagram","scheduled"],["facebook","scheduled"],["tiktok","awaiting_manual"]],{agent:"writer"});
await post("Harbour Coffee","Oat milk back in stock","Yes, finally.","scheduled",30,[["instagram","scheduled"],["facebook","scheduled"]],{agent:"writer"});
await post("Acme Robotics","Firmware 4.2 release notes","What changed in 4.2.","scheduled",8,[["linkedin","scheduled"],["x","scheduled"]],{agent:"writer"});
// Needs approval
await post("Acme Robotics","We are hiring: staff firmware engineer","Remote across EU/UK.","in_review",20,[["linkedin","pending"],["x","pending"]],{agent:"writer"});
await post("Northwind Legal","Q4 employment law changes","Three changes take effect this quarter.","in_review",3,[["linkedin","pending"],["x","pending"]],{agent:"writer"});
// Failed
await post("Northwind Legal","Webinar: GDPR in 2027","Join us Thursday.","failed",-3,[["linkedin","published"],["x","failed","401 Unauthorized: token revoked. Reconnect the account."]]);
await post("Acme Robotics","Demo day recap","Thanks to everyone who came.","failed",-14,[["linkedin","failed","Token expired 30 hours ago"],["x","published"]]);
// Draft with nothing scheduled for TikTok etc.
await post("Harbour Coffee","Winter menu teaser","Something warm is coming.","draft",null,[["instagram","pending"]]);

// Engagement: an angry customer overdue + a lead + routine
const i = async (brand, plat, kind, author, body, priority, dueH, reach, sentiment) =>
  sql`insert into interactions (id,brand_id,channel_id,kind,direction,status,priority,sentiment,author_name,author_handle,author_reach,body,received_at,due_at)
    values (${id()},${B[brand].id},${B[brand].ch[plat]},${kind},'inbound','new',${priority},${sentiment},${author},${"@"+author.toLowerCase().replace(/\W/g,"")},${reach},${body},${at(dueH-4)},${at(dueH)})`;
await i("Harbour Coffee","instagram","comment","Priya N","My order arrived cold and nobody replied to my DM. Genuinely disappointed.","high",-9,4200,"negative");
await i("Harbour Coffee","facebook","message","Tom Ellis","Do you do wholesale for cafes? Interested in 20kg a month.","high",2,300,"positive");
await i("Harbour Coffee","instagram","comment","Mia","Love this!!","low",20,80,"positive");
await i("Acme Robotics","x","mention","Dr R Patel","Does 4.2 fix the encoder drift on the A7 arm?","normal",-2,15000,"neutral");
await i("Northwind Legal","linkedin","review","A Client","Helpful on our employment dispute.","normal",30,50,"positive");

// Goals (with a metric history so pace can be judged)
const goal = async (brand, metric, name, start, target, daysLeft, series) => {
  const gid = id();
  const today = new Date();
  const sd = new Date(today.getTime() - 60 * D).toISOString().slice(0, 10);
  const dl = new Date(today.getTime() + daysLeft * D).toISOString().slice(0, 10);
  await sql`insert into goals (id,brand_id,metric,name,start_date,start_value,target_value,deadline,status,created_by)
    values (${gid},${B[brand].id},${metric},${name},${sd},${start},${target},${dl},'active',${uid})`;
  for (let k = 0; k < series.length; k++) {
    const d = new Date(today.getTime() - (series.length - 1 - k) * 7 * D).toISOString().slice(0, 10);
    await sql`insert into metric_snapshots (id,brand_id,scope_key,metric,date,value,source) values (${id()},${B[brand].id},'all',${metric},${d},${series[k]},'api')`;
  }
};
await goal("Harbour Coffee","followers","Reach 5,000 Instagram-era followers",3000,5000,60,[3000,3120,3260,3420,3600,3790,3990,4210,4400]);
await goal("Acme Robotics","followers","10k LinkedIn followers by year end",6000,10000,80,[6000,6030,6050,6080,6090,6120,6130,6140,6150]);
await goal("Northwind Legal","leads","20 enquiries a month",5,20,45,[5,6,6,7,8,8,9,9,10]);

// Agents: enabled, one failing
const agent = async (brand, code, enabled, lastRunH) =>
  sql`insert into brand_agents (id,brand_id,agent_code,enabled,last_run_at) values (${id()},${B[brand].id},${code},${enabled},${lastRunH===null?null:at(lastRunH)})`;
for (const b of ["Harbour Coffee","Acme Robotics","Northwind Legal"]) {
  await agent(b,"writer",true,-2); await agent(b,"community",true,-1); await agent(b,"analyst",true,-20); await agent(b,"strategist",b!=="Northwind Legal",-26);
}
const run = (brand, code, status, summary, error, hours) =>
  sql`insert into agent_runs (id,brand_id,agent_code,status,summary,error,started_at,finished_at,issues)
    values (${id()},${B[brand].id},${code},${status},${summary},${error},${at(hours)},${at(hours)},${j(status==="succeeded"?[]:[])})`;
await run("Harbour Coffee","writer","succeeded","Wrote 2 posts for next week, both passed the reviewer.",null,-2);
await run("Harbour Coffee","community","succeeded","Drafted 4 replies; held 1 (complaint) for you.",null,-1);
await run("Acme Robotics","writer","failed",null,"Anthropic API 401: invalid x-api-key. Nothing was written.",-2);
await run("Acme Robotics","writer","failed",null,"Anthropic API 401: invalid x-api-key. Nothing was written.",-8);
await run("Northwind Legal","analyst","failed",null,"LinkedIn metrics: token expired, 0 of 6 posts read.",-20);
await run("Northwind Legal","writer","succeeded","Wrote 1 post. Held for review (mentions 'compliance guarantee').",null,-3);

// Workflow pauses (review inbox): one safety stop
const runId = id();
await sql`insert into workflow_runs (id,brand_id,workflow_code,status,step_index,subject_type,subject_id,started_at,updated_at)
  values (${runId},${B["Northwind Legal"].id},'publish-post','waiting_review',0,'post',(select id from posts where title='Q4 employment law changes'),${at(-30)},${at(-30)})`;
await sql`insert into workflow_run_steps (id,run_id,brand_id,step_key,status,summary,pause,created_at)
  values (${id()},${runId},${B["Northwind Legal"].id},'draft','paused','Draft ready',${j({kind:"review",question:"Approve this post, or send it back with a note.",reasons:["Playbook must-rule: no claims without a source","Reviewer flagged: legal claim"],href:"/review",after:true,sendBackTo:"draft"})},${at(-30)})`;
const runId2 = id();
await sql`insert into workflow_runs (id,brand_id,workflow_code,status,step_index,subject_type,subject_id,started_at,updated_at)
  values (${runId2},${B["Acme Robotics"].id},'publish-post','waiting_review',0,'post',(select id from posts where title='We are hiring: staff firmware engineer'),${at(-6)},${at(-6)})`;
await sql`insert into workflow_run_steps (id,run_id,brand_id,step_key,status,summary,output,pause,created_at)
  values (${id()},${runId2},${B["Acme Robotics"].id},'draft','paused','Draft ready',${j({review:{score:92,flags:[],summary:"On brand, specific, no risky claims.",fixes:[],model:"haiku",reviewedAt:new Date().toISOString()}})},${j({kind:"review",question:"Approve this post, or send it back with a note.",reasons:["review is on for this step"],href:"/review",after:true,sendBackTo:"draft"})},${at(-6)})`;

console.log("seeded. login manager@ggsocial.test / walkthrough1");
await sql.end();
