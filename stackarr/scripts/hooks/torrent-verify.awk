# Input is unsigned decimal bytes from od. Print raw info offset and length only
# for a complete canonical metainfo dictionary. Never serialize/reencode info.
function bad() { invalid=1; exit 1 }
function number(    start,s,c) {
    start=pos; s=""
    while (pos<=n && (c=b[pos])!=101) {
        if (c<48 || c>57 || length(s)>18) bad()
        s=s sprintf("%c",c); pos++
    }
    if (pos>n || s=="" || s ~ /^0[0-9]/) bad()
    pos++; return s+0
}
function str(    s,len,c,j) {
    s=""; while(pos<=n && (c=b[pos])!=58) {
        if(c<48 || c>57 || length(s)>9) bad()
        s=s sprintf("%c",c); pos++
    }
    if(pos>n || s=="" || s ~ /^0[0-9]/) bad()
    len=s+0; pos++
    if(len>n-pos+1) bad()
    result=""
    # Keys are limited for memory and comparison; payload is skipped without copy.
    if(len<=256) for(j=0;j<len;j++) result=result sprintf("%c",b[pos+j])
    pos+=len; return len
}
function parse(depth, context,    c,key,prev,len,at,v,hasname,haslength,hasfiles,haspieces,haspiece_length,hasmeta,hastree, filelength) {
    if(depth>64 || pos>n) bad()
    c=b[pos++]
    if(c==105) { at=pos; v=number(); if(b[at]==45 && (b[at+1]==48 || at+1==pos-1)) bad(); return v }
    if(c>=48 && c<=57) { pos--; return str() }
    if(c==108) {
        v=0
        while(pos<=n && b[pos]!=101) {
            if(context=="files") { if(b[pos]!=100) bad(); parse(depth+1,"file") }
            else if(context=="path") { if(b[pos]<48 || b[pos]>57 || parse(depth+1,"")<=0) bad() }
            else parse(depth+1,"")
            v++
        }
        if(pos>n || ((context=="files" || context=="path") && v==0)) bad()
        pos++; return v
    }
    if(c!=100) bad()
    prev=""
    while(pos<=n && b[pos]!=101) {
        if(b[pos]<48 || b[pos]>57) bad()
        len=str(); key=result
        if(len>256 || (prev!="" && key<=prev)) bad()
        prev=key
        if(context=="root" && key=="info") {
            if(b[pos]!=100) bad()
            info_start=pos-1
            parse(depth+1,"info")
            info_length=pos-1-info_start
            found_info++
        } else if(context=="info" && key=="name") {
            if(b[pos]<48 || b[pos]>57) bad()
            hasname=(parse(depth+1,"")>0)
        } else if(context=="info" && key=="piece length") {
            if(b[pos]!=105) bad()
            haspiece_length=(parse(depth+1,"")>0)
        } else if(context=="info" && key=="pieces") {
            if(b[pos]<48 || b[pos]>57) bad()
            v=parse(depth+1,""); haspieces=(v>0 && v%20==0)
        } else if(context=="info" && key=="length") {
            if(b[pos]!=105) bad()
            haslength=(parse(depth+1,"")>=0)
        } else if(context=="info" && key=="files") {
            if(b[pos]!=108) bad()
            hasfiles=(parse(depth+1,"files")>0)
        } else if(context=="file" && key=="length") {
            if(b[pos]!=105) bad()
            haslength=(parse(depth+1,"")>=0)
        } else if(context=="file" && key=="path") {
            if(b[pos]!=108) bad()
            hasfiles=(parse(depth+1,"path")>0)
        } else if(context=="info" && key=="meta version") {
            if(b[pos]!=105) bad()
            hasmeta=(parse(depth+1,"")==2)
        } else if(context=="info" && key=="file tree") {
            if(b[pos]!=100) bad()
            hastree=(parse(depth+1,"tree")>0)
        } else if(context=="tree") {
            if(b[pos]!=100) bad()
            if(key=="") {
                parse(depth+1,"leaf")
            } else if(parse(depth+1,"tree")<=0) bad()
            hasfiles++
        } else if(context=="leaf" && key=="length") {
            if(b[pos]!=105) bad()
            haslength=(parse(depth+1,"")>=0)
        } else if(context=="leaf" && key=="pieces root") {
            if(b[pos]<48 || b[pos]>57 || parse(depth+1,"")!=32) bad()
            haspieces=1
        } else parse(depth+1,"")
    }
    if(pos>n) bad()
    pos++
    if(context=="file" && !(haslength && hasfiles)) bad()
    if(context=="leaf" && !(haslength && haspieces)) bad()
    if(context=="tree" && !hasfiles) bad()
    if(context=="info" && !(hasname && haspiece_length && ((haspieces && (haslength!=hasfiles)) || (hasmeta && hastree)))) bad()
    if(context=="tree") return hasfiles
    return 0
}
{ for(i=1;i<=NF;i++) { if($i !~ /^[0-9]+$/ || $i>255) bad(); b[++n]=$i+0 } }
END { if(!invalid) { pos=1; if(b[pos]!=100) exit 1; parse(0,"root"); if(pos!=n+1 || found_info!=1) exit 1; print info_start, info_length } }
