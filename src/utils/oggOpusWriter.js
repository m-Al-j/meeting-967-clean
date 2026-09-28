import fs from 'node:fs';
function crcTable(){const t=new Uint32Array(256);for(let i=0;i<256;i++){let r=i<<24;for(let j=0;j<8;j++)r=(r&0x80000000)?((r<<1)^0x04c11db7):(r<<1);t[i]=r>>>0;}return t;} const TABLE=crcTable();
function crc(buf){let r=0;for(const b of buf)r=((r<<8)^TABLE[((r>>>24)&0xff)^b])>>>0;return r>>>0;}
function u64le(n){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;}
function page({serial,seq,granule,headerType,packet}){const segs=[];let left=packet.length;while(left>=255){segs.push(255);left-=255;}segs.push(left);const h=Buffer.alloc(27+segs.length);h.write('OggS',0,'ascii');h[4]=0;h[5]=headerType;u64le(granule).copy(h,6);h.writeUInt32LE(serial>>>0,14);h.writeUInt32LE(seq>>>0,18);h.writeUInt32LE(0,22);h[26]=segs.length;segs.forEach((x,i)=>h[27+i]=x);const all=Buffer.concat([h,packet]);all.writeUInt32LE(crc(all),22);return all;}
function opusHead(){const b=Buffer.alloc(19);b.write('OpusHead',0,'ascii');b[8]=1;b[9]=2;b.writeUInt16LE(312,10);b.writeUInt32LE(48000,12);b.writeInt16LE(0,16);b[18]=0;return b;}
function opusTags(){const vendor=Buffer.from('Meeting 967','utf8');const b=Buffer.alloc(8+4+vendor.length+4);b.write('OpusTags',0,'ascii');b.writeUInt32LE(vendor.length,8);vendor.copy(b,12);b.writeUInt32LE(0,12+vendor.length);return b;}
export class OggOpusWriter{
  constructor(file){this.file=file;this.stream=fs.createWriteStream(file);this.serial=(Math.random()*0xffffffff)>>>0;this.seq=0;this.granule=0;this.packets=0;this.bytes=0;this.stream.write(page({serial:this.serial,seq:this.seq++,granule:0,headerType:2,packet:opusHead()}));this.stream.write(page({serial:this.serial,seq:this.seq++,granule:0,headerType:0,packet:opusTags()}));}
  write(packet){this.granule+=960;const p=page({serial:this.serial,seq:this.seq++,granule:this.granule,headerType:0,packet});this.stream.write(p);this.packets++;this.bytes+=packet.length;}
  async end(){const eos=page({serial:this.serial,seq:this.seq++,granule:this.granule,headerType:4,packet:Buffer.alloc(0)});this.stream.write(eos);await new Promise((resolve,reject)=>{this.stream.end(resolve);this.stream.on('error',reject);});return {packetCount:this.packets,bytes:this.bytes};}
}
