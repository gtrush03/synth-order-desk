export const CONSENT_VERSION = 'event-2026-09-11-v1';
export const INTERESTS = ['Memory & knowledge', 'Data & analytics', 'Agents & automation', 'Security', 'Meeting builders'] as const;
export const RESOURCE_EMAIL = {
 from: 'hello@trusynth.com',
 subject: 'Your Data & AI Hackathon resource guide',
 text: `Thanks for visiting the TRU Synth event workspace and requesting this one-time resource email.

Data & AI Hackathon · September 11, 2026
AWS Builder Loft, 525 Market St, San Francisco (Courtyard Entrance).

Explore the sponsor tools:
Cognee — memory construction: https://www.cognee.ai/
HydraDB — graph memory: https://www.hydradb.com/
Hotdata — isolated data queries: https://hotdata.dev/
RocketRide — orchestration: https://rocketride.ai/
Rote / Modiqo — reusable tool workflows: https://modiqo.ai/
Snyk — security: https://snyk.io/

Build checklist: choose one useful task; save what you learn; query the data; act with approval; replay the successful steps. Make each sponsor's contribution inspectable.

The agenda lists project submission at 3:30 PM and top-five demos at 4 PM. Follow the organizers instructions for the main submission; RocketRide asks sponsor projects in its Discord #showcase with GitHub link and .pipe files.

TRU Synth project: https://github.com/gtrush03/synth-order-desk

You requested this single resource message. You are not subscribed to marketing. Reply to hello@trusynth.com to request removal of your event signup. This workspace is a TRU Synth project, not the organizer's registration system.`
} as const;
export class InputError extends Error { constructor(message: string, public status=400){super(message);} }
export function validateSignup(value: unknown) {
 if(!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Enter your signup details.');
 const v=value as Record<string, unknown>;
 const field=(key:string,max:number,required=true)=>{const x=v[key]; if(typeof x!=='string'||x.length>max||/[\u0000-\u001f\u007f<>]/.test(x)|| (required&&!x.trim()))throw new InputError(`Check your ${key}.`);return x.trim();};
 const name=field('name',70), email=field('email',254).toLowerCase(), role=field('role',100,false), interest=field('interest',40);
 if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email))throw new InputError('Enter a valid email address.');
 if(!INTERESTS.includes(interest as typeof INTERESTS[number]))throw new InputError('Choose one of the listed interests.');
 if(v.storageConsent!==true||v.consentVersion!==CONSENT_VERSION)throw new InputError('Agree to the current signup privacy notice.');
 if(typeof v.directoryConsent!=='boolean'||typeof v.followupConsent!=='boolean')throw new InputError('Choose your sharing preferences.');
 if(v.website!==undefined&&v.website!=='')throw new InputError('Unable to accept this signup.');
 return {name,email,role,interest,directoryConsent:v.directoryConsent,followupConsent:v.followupConsent};
}
export async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');}
export async function readJson(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new InputError('Use JSON.',415);
 const reader=request.body?.getReader();if(!reader)throw new InputError('Missing details.');
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096){await reader.cancel();throw new InputError('Signup is too large.',413);}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes)) as unknown;}catch{throw new InputError('Check the signup details.');}
}
