export function commonsPage(index=0,mime="image/jpeg"){
  const filename=`Coffee_cup_${index}.${mime==="image/gif"?"gif":mime==="image/png"?"png":"jpg"}`;
  return {pageid:index+1,ns:6,title:`File:${filename}`,imageinfo:[{
    mime,size:200000,width:1600,height:1200,thumbwidth:300,thumbheight:300,thumbmime:mime,
    url:`https://upload.wikimedia.org/wikipedia/commons/a/ab/${filename}`,
    thumburl:`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${filename}/300px-${filename}`,
    descriptionurl:`https://commons.wikimedia.org/wiki/File:${filename}`,
    extmetadata:{Artist:{value:'<a href="https://example.com">Casey &amp; Robin</a><script>not attribution</script>'},
      LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"},
      Credit:{value:"<b>Own work</b>"},Attribution:{value:"Credit Casey &amp; Robin"},
      Restrictions:{value:"Check depicted subjects before sharing"}}
  }]};
}
export function commonsResponse(){return {batchcomplete:true,query:{pages:[commonsPage(),commonsPage(1),commonsPage(2)]}};}
