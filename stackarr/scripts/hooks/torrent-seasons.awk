# Bounded bencode parser for decimal bytes from `od -An -v -tu1`.
# Only dictionary keys and path components are materialized. Piece blobs,
# trackers, and unknown string values are consumed without storing them.
function fail() { bad=1; return -1 }
function byte(    line,n,i) {
    if (bad) return -1
    if (bi < 1 || bi > bn) {
        if ((getline line) <= 0) return -1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        bn=split(line, block, /[[:space:]]+/); bi=1
        if (!bn) return fail()
    }
    n=block[bi++]; if (n !~ /^[0-9]+$/ || n+0>255) return fail()
    return n+0
}
function peek() { if (!held) { ahead=byte(); held=1 } return ahead }
function take(    n) { if (held) { held=0; return ahead } return byte() }
function decimal(first, terminator, limit,    n,c,digits) {
    n=0; digits=0
    if (first==45) { negative=1; c=take() } else { negative=0; c=first }
    if (c<48 || c>57) return fail()
    do {
        if (++digits>limit || (digits>1 && leading) || (negative && digits==1 && c==48)) return fail()
        if (digits==1) leading=(c==48)
        n=n*10+(c-48); if (n>33554432 && terminator==58) return fail()
        c=take()
    } while (c>=48 && c<=57)
    if (c!=terminator || (negative && n==0)) return fail()
    return negative ? -n : n
}
function str(cap,    first,n,j,c,s) {
    first=take(); if (first<48 || first>57) return fail()
    n=decimal(first,58,10); if (bad || n<0) return fail()
    s=""
    for (j=0;j<n;j++) {
        c=take(); if(c<0) return fail()
        if (c==0 && cap>=0) return fail()
        if (cap>=0 && j<cap) s=s sprintf("%c",c)
    }
    if (cap>=0 && n>cap) return fail()
    value=s
    return n
}
function safe(s) { return s!="" && s!="." && s!=".." && s !~ /[\/\\]/ }
function encode(s) { return length(s) ":" s }
function video(s,    t) { t=tolower(s); return t ~ /\.(mkv|mp4|avi|m4v|mov|wmv|ts|webm)$/ }
function addmatches(s, kind,    t,r,n,rest,prefix,digits,nextc) {
    t=tolower(s); rest=t
    while (length(rest)) {
        if (kind=="episode") {
            if (!match(rest, /(^|[^a-z0-9])s[0-9][0-9]?[ ._-]*e[0-9][0-9]?[0-9]?/)) break
            r=substr(rest,RSTART,RLENGTH); nextc=substr(rest,RSTART+RLENGTH,1)
            if (nextc ~ /[0-9]/) { rest=substr(rest,RSTART+RLENGTH); continue }
            sub(/^.*s/,"",r); sub(/[ ._-]*e.*$/, "", r)
        } else if (kind=="x") {
            if (!match(rest, /(^|[^a-z0-9])[0-9][0-9]?x[0-9][0-9]?[0-9]?/)) break
            r=substr(rest,RSTART,RLENGTH); nextc=substr(rest,RSTART+RLENGTH,1)
            if (nextc ~ /[0-9]/) { rest=substr(rest,RSTART+RLENGTH); continue }
            sub(/x.*$/,"",r); sub(/^.*[^0-9]/,"",r)
        } else if (kind=="season") {
            if (!match(rest, /(^|[^a-z0-9])season[ ._-]*[0-9][0-9]?/)) break
            r=substr(rest,RSTART,RLENGTH); nextc=substr(rest,RSTART+RLENGTH,1)
            if (nextc ~ /[0-9]/) { rest=substr(rest,RSTART+RLENGTH); continue }
            sub(/^.*season[ ._-]*/,"",r)
        } else {
            if (!match(rest, /(^|[^a-z0-9])s[0-9][0-9]?/)) break
            r=substr(rest,RSTART,RLENGTH); nextc=substr(rest,RSTART+RLENGTH,1)
            if (nextc ~ /[a-z0-9]/) { rest=substr(rest,RSTART+RLENGTH); continue }
            sub(/^.*s/,"",r)
        }
        n=r+0; if (candidate!="" && candidate!=n) conflict=1
        candidate=n ""; rest=substr(rest,RSTART+RLENGTH)
    }
}
function record(path, pad, version,    count,j,n,s,key) {
    if (pad) return
    if (version==1) { v1[path]=1; v1count++ } else { v2[path]=1; v2count++ }
    # Extract length-prefixed components, not delimiter-split names.
    count=0; s=path; candidate=""; conflict=0
    while (length(s)) {
        if (!match(s,/^[0-9]+:/)) return fail()
        n=substr(s,1,RLENGTH-1)+0; s=substr(s,RLENGTH+1)
        if (n>length(s)) return fail()
        component[++count]=substr(s,1,n); s=substr(s,n+1)
        if (count>64) return fail()
    }
    if (!video(component[count])) return 0
    videos[version]++
    for(j=1;j<count;j++) { addmatches(component[j],"season"); addmatches(component[j],"short") }
    addmatches(component[count],"episode"); addmatches(component[count],"x"); addmatches(component[count],"season")
    if (conflict || candidate=="") unresolved[version]=1
    if (conflict) contradictions[version]=1
    else { if (season[version]!="" && season[version]!=candidate) multiple[version]=1; season[version]=candidate }
}
# Returns bencode kind: s (string), i, l, d. Context is an exact structural slot.
function item(depth,ctx,prefix,    ch,key,prev,child,kind,localpath,attr,haslen,haspath,entrypad,leaf,seen,rootname,sz) {
    if (++nodes>200000 || depth>64) return fail()
    ch=take(); if(ch<0) return fail()
    if (ch>=48 && ch<=57) {
        # Put the first digit back into the one-byte lookahead.
        held=1; ahead=ch
        if (ctx=="pathpart" || ctx=="rootname" || ctx=="key" || ctx=="attr") sz=str(1024)
        else sz=str(-1)
        if (sz<0 || bad) return fail()
        if (ctx=="pathpart" || ctx=="rootname") { if(!safe(value)) return fail() }
        return "s"
    }
    if (ch==105) {
        ch=take(); nvalue=decimal(ch,101,30)
        if (bad) return fail()
        return "i"
    }
    if (ch!=100 && ch!=108) return fail()
    if (ctx=="path" && ch!=108 || ctx=="files" && ch!=108 || ctx=="tree" && ch!=100 || ctx=="file" && ch!=100 || ctx=="leaf" && ch!=100 || ctx=="info" && ch!=100 || ctx=="root" && ch!=100) return fail()
    if (ch==108) {
        localpath=""; seen=0
        while (peek()!=101) {
            if (peek()<0) return fail()
            if (ctx=="path") {
                kind=item(depth+1,"pathpart",""); if(kind!="s") return fail()
                localpath=localpath encode(value); if (length(localpath)>4096) return fail()
            } else { kind=item(depth+1, ctx=="files" ? "file" : "other", ""); if (kind<0) return fail() }
            if (++seen>200000) return fail()
        }
        take(); if ((ctx=="path" || ctx=="files") && !seen) return fail()
        if (ctx=="path") value=localpath
        return "l"
    }
    prev=""; seen=0; localpath=""; attr=""; haslen=0; haspath=0; entrypad=0; leaf=0
    while (peek()!=101) {
        if (peek()<0 || ++seen>200000) return fail()
        if (item(depth+1,"key","")!="s") return fail()
        key=value
        if (seen>1 && key<=prev) return fail()
        prev=key
        child="other"
        if (ctx=="root" && key=="info") child="info"
        else if (ctx=="info") {
            if (key=="name" || key=="name.utf-8") child="rootname"
            else if (key=="files") child="files"
            else if (key=="file tree") child="tree"
        } else if (ctx=="file") {
            if (key=="path" || key=="path.utf-8") child="path"
        } else if (ctx=="tree") {
            if (key=="") { if(prefix=="" || seen!=1) return fail(); child="leaf" }
            else { if(!safe(key) || length(prefix)+length(key)>4096) return fail(); child="tree" }
        }
        if ((ctx=="file" || ctx=="leaf") && key=="attr") child="attr"
        kind=item(depth+1,child, ctx=="tree" ? (key=="" ? prefix : prefix encode(key)) : "")
        if (kind<0) return fail()
        if (ctx=="root" && key=="info") { if (kind!="d") return fail(); info=1 }
        if (ctx=="info") {
            if (key=="name" || key=="name.utf-8") { if(kind!="s") return fail(); name= value; named=1 }
            else if (key=="files") { if(kind!="l") return fail(); hasfiles=1 }
            else if (key=="file tree") { if(kind!="d") return fail(); hastree=1 }
            else if (key=="length") { if(kind!="i" || nvalue<0) return fail(); lengthset=1 }
            else if (key=="meta version") { if(kind!="i" || nvalue!=2) return fail(); version=2 }
        } else if (ctx=="file" || ctx=="leaf") {
            if(key=="length") { if(kind!="i" || nvalue<0) return fail(); haslen=1 }
            else if(key=="path" || key=="path.utf-8") { if(kind!="l") return fail(); localpath=value; haspath=1 }
            else if(key=="attr") { if(kind!="s") return fail(); entrypad=index(value,"p")>0 }
        } else if(ctx=="tree" && key=="") { if(kind!="d") return fail(); leaf=1 }
    }
    take()
    if(ctx=="file") { if(!haslen || !haspath) return fail(); record(localpath,entrypad,1) }
    if(ctx=="leaf") { if(!haslen) return fail(); record(prefix,entrypad,2) }
    if(ctx=="tree" && !seen) return fail()
    if(ctx=="tree" && leaf && seen!=1) return fail()
    return "d"
}
BEGIN {
    FS="[[:space:]]+"
    result=item(0,"root","")
    if (!bad && !hasfiles && lengthset && named) record(encode(name),0,1)
    if (!bad && result=="d" && peek()==-1 && info && named) {
        if (version==2 && hastree) {
            valid=1
            if (hasfiles || lengthset) {
                for (p in v1) if (!(p in v2)) valid=0
                for (p in v2) if (!(p in v1)) valid=0
            }
            choice=2
        } else if (version!=2 && !hastree && (hasfiles || lengthset)) { valid=1; choice=1 }
        if (valid && !unresolved[choice] && videos[choice]>0) {
            if (multiple[choice]) print "multi"
            else if (season[choice]!="") print "single " season[choice]
            else if (evidence && videos[choice]==1) print "one unknown"
            else print "unknown"
            exit
        }
        if (valid && evidence && videos[choice]==1 && !contradictions[choice] && season[choice]=="") { print "one unknown"; exit }
    }
    print "unknown"
}
