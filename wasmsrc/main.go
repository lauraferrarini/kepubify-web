//go:build js && wasm

// Command kepubify-web-wasm exposes pgaskin/kepubify's EPUB→KEPUB converter
// to JavaScript via syscall/js, for 100% client-side, in-browser conversion.
//
// It is compiled with:
//
//	GOOS=js GOARCH=wasm go build -tags zip117 -o kepubify.wasm ./wasmsrc
//
// and loaded in the browser alongside Go's wasm_exec.js glue script. See
// ../docs/app.js for the JavaScript side.
package main

import (
	"archive/zip"
	"bytes"
	"context"
	"syscall/js"

	"github.com/pgaskin/kepubify/v4/kepub"
)

// jsConvert is exposed as window.kepubifyConvert(uint8Array).
// It returns {ok: true, data: Uint8Array} on success, or {ok: false, error: string} on failure.
func jsConvert(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return jsErr("missing epub bytes argument")
	}

	in := make([]byte, args[0].Get("length").Int())
	js.CopyBytesToGo(in, args[0])

	zr, err := zip.NewReader(bytes.NewReader(in), int64(len(in)))
	if err != nil {
		return jsErr("not a valid epub/zip file: " + err.Error())
	}

	c := kepub.NewConverterWithOptions(
		kepub.ConverterOptionSmartypants(),
	)

	var out bytes.Buffer
	if err := c.Convert(context.Background(), &out, zr); err != nil {
		return jsErr("conversion failed: " + err.Error())
	}

	return jsOK(out.Bytes())
}

func jsOK(data []byte) map[string]any {
	arr := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(arr, data)
	return map[string]any{"ok": true, "data": arr}
}

func jsErr(msg string) map[string]any {
	return map[string]any{"ok": false, "error": msg}
}

func main() {
	js.Global().Set("kepubifyConvert", js.FuncOf(jsConvert))
	js.Global().Set("kepubifyReady", true)

	// Keep the Go runtime alive so the exposed function stays callable.
	select {}
}
