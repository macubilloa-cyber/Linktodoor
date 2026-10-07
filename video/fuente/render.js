const {chromium}=require('/opt/node22/lib/node_modules/playwright');const {spawn}=require('child_process');
(async()=>{const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1080,height:1920}});
await pg.goto('file://'+__dirname+'/video.html');await pg.evaluate(()=>document.fonts.ready);
const FPS=30,N=Math.round(await pg.evaluate(()=>TOTAL)*FPS);
const ff=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate',''+FPS,'-c:v','mjpeg','-i','-','-i','music.wav',
 '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','out.mp4'],{stdio:['pipe','inherit','inherit']});
for(let i=0;i<N;i++){await pg.evaluate(t=>render(t),i/FPS);const buf=await pg.screenshot({type:'jpeg',quality:93});
 if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r)); if(i%300==0)console.log(i,'/',N);}
ff.stdin.end();await new Promise(r=>ff.on('close',r));await b.close();})();
