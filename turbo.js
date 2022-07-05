(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else if (typeof module === 'object' && module.exports) {
		// Node. Does not work with strict CommonJS, but
		// only CommonJS-like environments that support module.exports,
		// like Node.
		module.exports = factory();
	} else {
		// Browser globals (root is window)
		root.turbojs = factory();
	}
}(this, function () {

	// turbo.js
	// (c) turbo - github.com/turbo
	// MIT licensed

	"use strict";

	// Mozilla reference init implementation
	const initGLFromCanvas = function(canvas) {
		let gl = null;
		const attr = {alpha : false, antialias : false};

		// Try to grab the standard context. If it fails, fallback to experimental.
		gl = canvas.getContext("webgl", attr) || canvas.getContext("experimental-webgl", attr);

		// If we don't have a GL context, give up now
		if (!gl)
			throw new Error("turbojs: Unable to initialize WebGL. Your browser may not support it.");

		return gl;
	}

	const gl = initGLFromCanvas(document.createElement('canvas'));

	// turbo.js requires a 32bit float vec4 texture. Some systems only provide 8bit/float
	// textures. A workaround is being created, but turbo.js shouldn't be used on those
	// systems anyway.
	if (!gl.getExtension('OES_texture_float'))
		throw new Error('turbojs: Required texture format OES_texture_float not supported.');

	// GPU texture buffer from JS typed array
	function newBuffer(data, f, e) {
		const buf = gl.createBuffer();

		gl.bindBuffer((e || gl.ARRAY_BUFFER), buf);
		gl.bufferData((e || gl.ARRAY_BUFFER), new (f || Float32Array)(data), gl.STATIC_DRAW);

		return buf;
	}

	const positionBuffer = newBuffer([ -1, -1, 1, -1, 1, 1, -1, 1 ]);
	const textureBuffer  = newBuffer([  0,  0, 1,  0, 1, 1,  0, 1 ]);
	const indexBuffer    = newBuffer([  1,  2, 0,  3, 0, 2 ], Uint16Array, gl.ELEMENT_ARRAY_BUFFER);

	const vertexShaderCode = 
	`
	varying vec2 pos;
	attribute vec2 position;
	attribute vec2 texture;

	void main(void) {
	  pos = texture;
	  gl_Position = vec4(position.xy, 0.0, 1.0);
	}
	`;

	const stdlib =
	`
	precision mediump float;

	uniform sampler2D u_texture0;
	uniform sampler2D u_texture1;
	uniform sampler2D u_texture2;
	varying vec2 pos;

	vec4 read0(void) { return texture2D(u_texture0, pos); }
	vec4 read1(void) { return texture2D(u_texture1, pos); }
	vec4 read2(void) { return texture2D(u_texture2, pos); }
	//
	void commit(vec4 val) { gl_FragColor = val; }

	// user code begins here
	`;

	const vertexShader = gl.createShader(gl.VERTEX_SHADER);

	gl.shaderSource(vertexShader, vertexShaderCode);
	gl.compileShader(vertexShader);

	// This should not fail.
	if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
		throw new Error(
			"\nturbojs: Could not build internal vertex shader (fatal).\n" + "\n" +
			"INFO: >REPORT< THIS. That's our fault!\n" + "\n" +
			"--- CODE DUMP ---\n" + vertexShaderCode + "\n\n" +
			"--- ERROR LOG ---\n" + gl.getShaderInfoLog(vertexShader)
		);

	// Transfer data onto clamped texture and turn off any filtering
	function createTexture(data, size) {
		const texture = gl.createTexture();

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.FLOAT, data);
		gl.bindTexture(gl.TEXTURE_2D, null);

		return texture;
	}

	return {
		// run code against a pre-allocated array
		run : function(ipt0, ipt1, ipt2, iptRes, code) {
			const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

			gl.shaderSource(
				fragmentShader,
				stdlib + code
			);

			gl.compileShader(fragmentShader);

			// Use this output to debug the shader
			// Keep in mind that WebGL GLSL is **much** stricter than e.g. OpenGL GLSL
			if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
				const LOC = code.split('\n');
				let dbgMsg = "ERROR: Could not build shader (fatal).\n\n------------------ KERNEL CODE DUMP ------------------\n"

				for (var nl = 0; nl < LOC.length; nl++)
					dbgMsg += (stdlib.split('\n').length + nl) + "> " + LOC[nl] + "\n";

				dbgMsg += "\n--------------------- ERROR  LOG ---------------------\n" + gl.getShaderInfoLog(fragmentShader)

				throw new Error(dbgMsg);
			}

			const program = gl.createProgram();

			gl.attachShader(program, vertexShader);
			gl.attachShader(program, fragmentShader);
			gl.linkProgram(program);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS))
				throw new Error('turbojs: Failed to link GLSL program code.');

			const uTexture0 = gl.getUniformLocation(program, 'u_texture0');
			const uTexture1 = gl.getUniformLocation(program, 'u_texture1');
			const uTexture2 = gl.getUniformLocation(program, 'u_texture2');
			const aPosition = gl.getAttribLocation(program, 'position');
			const aTexture = gl.getAttribLocation(program, 'texture');

			gl.useProgram(program);

			const size = Math.sqrt(ipt0.data.length) / 4;
			const texture0 = createTexture(ipt0.data, size);
			const texture1 = createTexture(ipt1.data, size);
			const texture2 = createTexture(ipt2.data, size);

			gl.viewport(0, 0, size, size);
			gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());

			// Types arrays speed this up tremendously.
			const nTexture = createTexture(new Float32Array(ipt0.data.length), size);

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nTexture, 0);

			// Test for mobile bug MDN->WebGL_best_practices, bullet 7
			const frameBufferStatus = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE);

			if (!frameBufferStatus)
				throw new Error('turbojs: Error attaching float texture to framebuffer. Your device is probably incompatible. Error info: ' + frameBufferStatus.message);

			
			// **************************************************************************************************************************
			//   ORIGINALLY, the order of these 2 lines (activeTex/bindTex) was inverted, so it wasn't working with more than 1 texture.
			// **************************************************************************************************************************
			gl.activeTexture(gl.TEXTURE0); 
			gl.bindTexture(gl.TEXTURE_2D, texture0);
			gl.uniform1i(uTexture0, 0);
			// 
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, texture1);
			gl.uniform1i(uTexture1, 1);
			//
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, texture2);
			gl.uniform1i(uTexture2, 2);
			//
			//
			gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
			gl.enableVertexAttribArray(aTexture);
			gl.vertexAttribPointer(aTexture, 2, gl.FLOAT, false, 0, 0);
			//
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.enableVertexAttribArray(aPosition);
			gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
			//
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			//
			gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
			gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, iptRes.data);
			//                                 ^ 4 x 32 bit ^

			//return ipt0.data.subarray(0, ipt0.length);
		},
		alloc: function(sz) {
			// A sane limit for most GPUs out there.
			// JS falls apart before GLSL limits could ever be reached.
			if (sz > 16777216)
				throw new Error("turbojs: Whoops, the maximum array size is exceeded!");

			const ns = Math.pow(Math.pow(2, Math.ceil(Math.log(sz) / 1.386) - 1), 2);
			return {
				data : new Float32Array(ns * 16),
				length : sz
			};
		}
	};

}));


