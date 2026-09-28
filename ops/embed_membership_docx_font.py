from __future__ import annotations
import os
import shutil
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
q=lambda ns, tag: f'{{{ns}}}{tag}'

PREFERRED_FONTS=[
    ('/system/fonts/NotoSansArabic-Regular.ttf','Noto Sans Arabic'),
    ('/system/fonts/NotoSansArabicUI-Regular.ttf','Noto Sans Arabic UI'),
    ('/system/fonts/NotoNaskhArabic-Regular.ttf','Noto Naskh Arabic'),
    ('/system/fonts/NotoKufiArabic-Regular.ttf','Noto Kufi Arabic'),
    ('/system/fonts/NotoNaskhArabicUI-Regular.ttf','Noto Naskh Arabic UI'),
    ('/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf','Noto Sans Arabic'),
    ('/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf','Noto Naskh Arabic'),
    ('/usr/share/fonts/truetype/noto/NotoKufiArabic-Regular.ttf','Noto Kufi Arabic'),
    ('/usr/share/fonts/opentype/fonts-hosny-amiri/Amiri-Regular.ttf','Amiri'),
]

def find_font():
    env=os.environ.get('IDENTITY967_ARABIC_FONT','').strip()
    if env and Path(env).is_file():
        name=Path(env).name
        family={
            'NotoSansArabic-Regular.ttf':'Noto Sans Arabic',
            'NotoSansArabicUI-Regular.ttf':'Noto Sans Arabic UI',
            'NotoNaskhArabic-Regular.ttf':'Noto Naskh Arabic',
            'NotoKufiArabic-Regular.ttf':'Noto Kufi Arabic',
            'NotoNaskhArabicUI-Regular.ttf':'Noto Naskh Arabic UI',
            'Amiri-Regular.ttf':'Amiri',
        }.get(name, 'Noto Sans Arabic')
        return Path(env), family
    for path,family in PREFERRED_FONTS:
        p=Path(path)
        if p.is_file():
            return p,family
    system=Path('/system/fonts')
    if system.is_dir():
        candidates=sorted(system.glob('*.ttf'))+sorted(system.glob('*.otf'))
        for p in candidates:
            n=p.name.lower()
            if any(k in n for k in ('arabic','naskh','kufi')):
                if 'naskh' in n:
                    return p,'Noto Naskh Arabic'
                if 'kufi' in n:
                    return p,'Noto Kufi Arabic'
                return p,'Noto Sans Arabic'
    return None,None

def patch_docx(src,dst):
    src=Path(src); dst=Path(dst)
    font,font_family=find_font()
    parser=etree.XMLParser(remove_blank_text=False)

    with tempfile.TemporaryDirectory() as td_raw:
        td=Path(td_raw)
        with ZipFile(src,'r') as zin:
            zin.extractall(td)

        doc=td/'word/document.xml'
        root=etree.parse(str(doc),parser).getroot()

        for p in root.iter(q(W,'p')):
            ppr=p.find(q(W,'pPr'))
            if ppr is None:
                ppr=etree.Element(q(W,'pPr'))
                p.insert(0,ppr)
            if ppr.find(q(W,'bidi')) is None:
                ppr.insert(0,etree.Element(q(W,'bidi')))
            for rnode in p.iter(q(W,'r')):
                rpr=rnode.find(q(W,'rPr'))
                if rpr is None:
                    rpr=etree.Element(q(W,'rPr'))
                    rnode.insert(0,rpr)
                if rpr.find(q(W,'rtl')) is None:
                    rpr.append(etree.Element(q(W,'rtl')))
                rf=rpr.find(q(W,'rFonts'))
                if rf is None:
                    rf=etree.Element(q(W,'rFonts'))
                    rpr.insert(0,rf)
                if font_family:
                    for attr in ('ascii','hAnsi','cs','eastAsia'):
                        rf.set(q(W,attr),font_family)
                    rf.set(q(W,'hint'),'cs')
                lang=rpr.find(q(W,'lang'))
                if lang is None:
                    lang=etree.Element(q(W,'lang'))
                    rpr.append(lang)
                lang.set(q(W,'val'),'ar-SA')
                lang.set(q(W,'bidi'),'ar-SA')

        doc.write_bytes(etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True))

        # Patch Normal/default paragraph fonts too.
        styles=td/'word/styles.xml'
        if styles.exists():
            sr=etree.parse(str(styles),parser).getroot()
            for st in sr.iter(q(W,'style')):
                name=st.find(q(W,'name'))
                if name is None or name.get(q(W,'val')) not in ('Normal','Default Paragraph Font'):
                    continue
                rpr=st.find(q(W,'rPr'))
                if rpr is None:
                    rpr=etree.Element(q(W,'rPr')); st.append(rpr)
                rf=rpr.find(q(W,'rFonts'))
                if rf is None:
                    rf=etree.Element(q(W,'rFonts')); rpr.insert(0,rf)
                if font_family:
                    for attr in ('ascii','hAnsi','cs','eastAsia'):
                        rf.set(q(W,attr),font_family)
                    rf.set(q(W,'hint'),'cs')
            styles.write_bytes(etree.tostring(sr,xml_declaration=True,encoding='UTF-8',standalone=True))

        if font and font_family:
            fonts_dir=td/'word/fonts'
            fonts_dir.mkdir(parents=True,exist_ok=True)
            target=fonts_dir/font.name
            shutil.copy2(font,target)

            ft=td/'word/fontTable.xml'
            ft_root=etree.Element(q(W,'fonts'),nsmap={'w':W,'r':R})
            font_el=etree.SubElement(ft_root,q(W,'font'))
            font_el.set(q(W,'name'),font_family)
            emb=etree.SubElement(font_el,q(W,'embedRegular'))
            emb.set(q(R,'id'),'rIdEmbedArabic')
            ft.write_bytes(etree.tostring(ft_root,xml_declaration=True,encoding='UTF-8',standalone=True))

            rel_dir=td/'word/_rels'
            rel_dir.mkdir(parents=True,exist_ok=True)
            relroot=etree.Element(q(REL,'Relationships'))
            rel=etree.SubElement(relroot,q(REL,'Relationship'))
            rel.set('Id','rIdEmbedArabic')
            rel.set('Type',f'{R}/font')
            rel.set('Target',f'fonts/{font.name}')
            (rel_dir/'fontTable.xml.rels').write_bytes(
                etree.tostring(relroot,xml_declaration=True,encoding='UTF-8',standalone=True)
            )

            ct=td/'[Content_Types].xml'
            cr=etree.parse(str(ct),parser).getroot()
            part=f'/word/fonts/{font.name}'
            if not any(x.get('PartName')==part for x in cr):
                o=etree.SubElement(cr,q(CT,'Override'))
                o.set('PartName',part)
                o.set('ContentType','application/x-font-ttf' if font.suffix.lower()=='.ttf' else 'application/x-font-opentype')
            ct.write_bytes(etree.tostring(cr,xml_declaration=True,encoding='UTF-8',standalone=True))
        else:
            print('⚠️ لم يتم العثور على خط عربي في الجهاز؛ تم تطبيق RTL فقط.',file=sys.stderr)

        dst.parent.mkdir(parents=True,exist_ok=True)
        with ZipFile(dst,'w',ZIP_DEFLATED) as zout:
            for p in td.rglob('*'):
                if p.is_file():
                    zout.write(p,p.relative_to(td).as_posix())

        return font_family

if __name__=='__main__':
    if len(sys.argv)!=3:
        raise SystemExit('usage: embed_membership_docx_font.py INPUT.docx OUTPUT.docx')
    family=patch_docx(sys.argv[1],sys.argv[2])
    print(f'✅ Arabic font: {family or "RTL only"}')
