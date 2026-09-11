import {Database} from 'bun:sqlite';
import {readFileSync} from 'node:fs';
export function testDatabase(){
 const sqlite=new Database(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_event.sql',import.meta.url),'utf8'));
 const prepare=(sql:string)=>{let values:unknown[]=[];const bound={bind(...v:unknown[]){values=v;return bound;},async first(){return sqlite.query(sql).get(...values as [])??null;},async all(){return {results:sqlite.query(sql).all(...values as [])};},async run(){return sqlite.query(sql).run(...values as []);}};return bound;};
 return {sqlite,db:{prepare} as unknown as D1Database};
}
