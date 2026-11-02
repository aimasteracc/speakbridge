"""Fixed benchmark: first N WAV entries in each FLEURS test archive (default 8).
No filtering on recognition results. References come from the published TSV.
Google FLEURS: https://huggingface.co/datasets/google/fleurs (CC BY 4.0).
Only the required prefix of each archive is read, not the full dataset.
"""
import argparse, csv, hashlib, io, json, pathlib, tarfile, urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--count', type=int, default=8)
parser.add_argument('--output', default='test-artifacts/asr-quality')
parser.add_argument('--revision', default='70bb2e84b976b7e960aa89f1c648e09c59f894dd')
args = parser.parse_args()
if not 1 <= args.count <= 100: parser.error('--count must be between 1 and 100')
root = pathlib.Path(__file__).resolve().parents[1] / args.output
root.mkdir(parents=True, exist_ok=True)
revision = args.revision
rows = []
for language, config in [('zh', 'cmn_hans_cn'), ('ja', 'ja_jp')]:
    base = f'https://huggingface.co/datasets/google/fleurs/resolve/{revision}/data/{config}'
    tsv = urllib.request.urlopen(base + '/test.tsv').read().decode('utf-8')
    refs = {r[1]: r for r in csv.reader(io.StringIO(tsv), delimiter='\t')}
    with urllib.request.urlopen(base + '/audio/test.tar.gz', timeout=120) as response:
        with tarfile.open(fileobj=response, mode='r|gz') as archive:
            count = 0
            for member in archive:
                if not member.isfile() or not member.name.endswith('.wav'): continue
                name = pathlib.PurePosixPath(member.name).name
                ref = refs[name]
                data = archive.extractfile(member).read()
                file = f'{language}-{name}'
                (root / file).write_bytes(data)
                rows.append(dict(file=file, language=language, id=ref[0], reference=ref[3],
                                 samples=int(ref[5]), gender=ref[6], sha256=hashlib.sha256(data).hexdigest()))
                count += 1
                if count == args.count: break
    print(language, count, 'fixed archive-order samples downloaded', flush=True)
(root / 'corpus.json').write_text(json.dumps(dict(dataset='google/fleurs', revision=revision,
    license='CC-BY-4.0', selection=f'First {args.count} WAV archive entries per language, no result filtering', rows=rows), ensure_ascii=False, indent=2))
