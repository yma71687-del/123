import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../../frontend/src/history";
import { emptyProject, objectDefaults } from "../../frontend/src/schema";
test("add, edit, duplicate and delete can be undone and redone without mutating previous snapshots", () => {
  const initial = emptyProject(),
    h = new History(initial),
    object = objectDefaults("primitive", { geometry: "box" });
  h.execute("添加", (p) => {
    p.objects.push(object);
  });
  const added = h.current;
  h.execute("变换", (p) => {
    p.objects[0].x = 2;
    p.objects[0].ry = Math.PI / 2;
  });
  assert.equal(added.objects[0].x, 0);
  assert.equal(initial.objects.length, 0);
  h.execute("复制", (p) => {
    p.objects.push({ ...p.objects[0], id: "f".repeat(32) });
  });
  h.execute("删除", (p) => {
    p.objects.splice(0, 1);
  });
  for (let i = 0; i < 4; i++) h.undo();
  assert.deepEqual(h.current, initial);
  assert.equal(h.canUndo, false);
  for (let i = 0; i < 4; i++) h.redo();
  assert.equal(h.current.objects.length, 1);
  assert.equal(h.current.objects[0].x, 2);
  assert.equal(h.canRedo, false);
});
test("a complete drag is one command and cancellation restores the exact starting project", () => {
  const h = new History(emptyProject());
  h.execute("添加", (p) => {
    p.objects.push(objectDefaults("primitive", { geometry: "sphere" }));
  });
  const before = h.current;
  h.beginGesture();
  for (let i = 1; i <= 30; i++)
    h.preview((p) => {
      p.objects[0].x = i / 10;
    });
  h.endGesture();
  assert.equal(h.current.objects[0].x, 3);
  h.undo();
  assert.deepEqual(h.current, before);
  h.redo();
  const drag = h.current;
  h.beginGesture();
  h.preview((p) => {
    p.objects[0].sx = 2;
  });
  h.endGesture(true);
  assert.deepEqual(h.current, drag);
  h.undo();
  assert.deepEqual(h.current, before);
});
test("new edits invalidate redo, invalid commands preserve document and stacks", () => {
  const h = new History(emptyProject());
  h.execute("改名", (p) => {
    p.name = "A";
  });
  h.undo();
  const original = h.current;
  assert.throws(() =>
    h.execute("无效", (p) => {
      p.duration = -1;
    }),
  );
  assert.equal(h.current, original);
  assert.equal(h.canRedo, true);
  h.execute("改名", (p) => {
    p.name = "B";
  });
  assert.equal(h.canRedo, false);
  h.undo();
  assert.equal(h.current.name, emptyProject().name);
});
test("consecutive field inputs merge, reset clears history and history is bounded", () => {
  const h = new History(emptyProject(), 2);
  h.execute(
    "输入",
    (p) => {
      p.name = "A";
    },
    "name",
  );
  h.execute(
    "输入",
    (p) => {
      p.name = "AB";
    },
    "name",
  );
  h.undo();
  assert.equal(h.current.name, emptyProject().name);
  h.reset(emptyProject());
  assert.equal(h.canRedo, false);
  assert.equal(h.canUndo, false);
  for (let i = 1; i <= 5; i++)
    h.execute("更名", (p) => {
      p.name = String(i);
    });
  for (let i = 0; i < 5; i++) h.undo();
  assert.equal(h.current.name, "3");
});
