"""Local HydraDB projection of one order's explicit constraints; no cloud model."""
import hashlib,json,os,sys,time
from neo4j import GraphDatabase
p=json.load(sys.stdin);run=p['id'];company=p['company'];notes=p['notes']
uri=os.environ.get('HYDRADB_URI','');password=os.environ.get('HYDRADB_PASSWORD','')
if not uri: raise SystemExit('HydraDB is not configured')
def identity(value):return int(hashlib.sha256(('orderdesk:'+value).encode()).hexdigest()[:15],16)
source=identity(run);deadline=identity(run+':deadline');rule=identity(run+':policy')
rows=[{'vertex':source,'name':'Order '+run,'kind':'order','synth':'hackathon-orderdesk','value':run},{'vertex':deadline,'name':'Delivery deadline','kind':'deadline','synth':'hackathon-orderdesk','value':company['deadline']},{'vertex':rule,'name':'Company shipment instruction','kind':'policy','synth':'hackathon-orderdesk','value':'\n'.join(notes)}]
start=time.time()
with GraphDatabase.driver(uri,auth=(os.environ.get('HYDRADB_USER','neo4j'),password) if password else None) as d:
 with d.session(database=os.environ.get('HYDRADB_DATABASE','default')) as s:
  s.run('UNWIND $rows AS row MERGE (n {id: row.vertex}) SET n:Entity, n.name = row.name, n.kind = row.kind, n.synth = row.synth, n.value = row.value',rows=rows).consume()
  s.run('UNWIND $rows AS row MATCH (a:Entity {id: row.src}), (b:Entity {id: row.dst}) CREATE (a)-[:orderdesk_requires]->(b)',rows=[{'src':source,'dst':deadline},{'src':source,'dst':rule}]).consume()
  result=[r.data() for r in s.run('MATCH (a {id: $id})-[:orderdesk_requires]->(b:Entity) RETURN b.kind AS kind, b.value AS value',id=source)]
if len(result)!=2:raise SystemExit('HydraDB did not return both order constraints')
print(json.dumps({'engine':'HydraDB','orderNode':str(source),'rows':result,'ms':round((time.time()-start)*1000),'cloudModelCalls':0}))
