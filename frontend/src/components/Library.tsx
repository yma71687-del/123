import { useRef } from "react";
import { assetKind, TEMPLATES, type Template } from "../schema";
import { Button, type PanelProps } from "./controls";
export function Library({ editor, state }: PanelProps) {
  const file = useRef<HTMLInputElement>(null),
    unavailable = state.busy || state.recording || state.dragging;
  return (
    <aside className="panel library">
      <details open>
        <summary>01 / 横版场景库</summary>
        <div className="section-content">
          <div className="template">
            {(Object.keys(TEMPLATES) as Template[]).map((name) => (
              <button
                type="button"
                key={name}
                className={
                  "tpl " +
                  name +
                  (state.project.template === name ? " active" : "")
                }
                data-template={name}
                disabled={unavailable || state.rendererState !== "ready"}
                onClick={() => editor.run(() => editor.chooseTemplate(name))}
              >
                <div className={"tpl-art " + name}>
                  <i />
                  <i />
                  <i />
                </div>
                <strong>{TEMPLATES[name].name}</strong>
                <small>{TEMPLATES[name].description}</small>
              </button>
            ))}
          </div>
          <p className="muted">
            四套不同的参数化几何场景。环境装饰由模板控制；新增对象可自由变换。
          </p>
        </div>
      </details>
      <details open>
        <summary>02 / 素材与对象</summary>
        <div className="section-content">
          <Button
            action="pick-assets"
            className="primary wide"
            disabled={unavailable}
            onClick={() => file.current?.click()}
          >
            ＋ 导入图片／音频／视频
          </Button>
          <input
            ref={file}
            id="assetFile"
            type="file"
            multiple
            accept="image/*,audio/*,video/*"
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              editor.run(() => editor.upload(files));
              e.target.value = "";
            }}
          />
          <div id="assets" className="assets">
            {state.project.assets.length ? (
              state.project.assets.map((asset) => (
                <div className="asset" data-asset={asset.id} key={asset.id}>
                  <strong>{asset.name}</strong>
                  <small>
                    {Math.round(asset.size / 1024)} KB · {assetKind(asset)}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">尚未导入素材</p>
            )}
          </div>
          <p className="muted">
            图片加入场景，音频可试听；视频目前仅登记，不参与逐帧合成。
          </p>
          <div className="row wrap">
            <Button
              action="add-text"
              disabled={unavailable || state.rendererState !== "ready"}
              onClick={() => editor.run(() => editor.addText())}
            >
              ＋ 标题
            </Button>
            {(["box", "sphere", "torus"] as const).map((kind, i) => (
              <Button
                key={kind}
                action={"add-" + kind}
                disabled={unavailable || state.rendererState !== "ready"}
                onClick={() => editor.run(() => editor.addPrimitive(kind))}
              >
                {["＋ 立方体", "＋ 球体", "＋ 圆环"][i]}
              </Button>
            ))}
          </div>
          <h3>
            对象树 <span className="tag">{state.project.objects.length}</span>
          </h3>
          <div className="object-tree" role="tree" aria-label="场景对象">
            {state.project.objects.length ? (
              state.project.objects.map((object) => (
                <button
                  key={object.id}
                  type="button"
                  role="treeitem"
                  aria-selected={state.selectedId === object.id}
                  data-object-id={object.id}
                  className={
                    "object-row" +
                    (state.selectedId === object.id ? " selected" : "")
                  }
                  disabled={unavailable}
                  onClick={() => editor.select(object.id)}
                >
                  <span>
                    {object.kind === "primitive"
                      ? "◇"
                      : object.kind === "image"
                        ? "▧"
                        : "T"}
                  </span>
                  <span>{object.name}</span>
                  <small>{object.visible ? "" : "隐藏"}</small>
                </button>
              ))
            ) : (
              <p className="muted">导入图片或添加 3D 对象开始创作</p>
            )}
          </div>
        </div>
      </details>
    </aside>
  );
}
