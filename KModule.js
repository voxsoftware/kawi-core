var eval1= function(str){
	return eval(str)
}
var Next= require("./NextJavascript")
var fs= require("fs")
var Os= require("os")
var Path= require("path")
var Module = require("module").Module
var Url= require('url')

var httpr={}

var Mod= exports.Module= function(){
}

Mod._cache = {}
Mod._cacherequire = {}
Mod.cachetime= 10000

Module._originalResolveFilename = Module._resolveFilename
Module._resolveFilename= function(name){
	if(name.startsWith("___kawi__internal__")){
		return name 
	}
	return Module._originalResolveFilename.apply(Module, arguments)
}


var builtinModules = require("module").builtinModules
var validateFileUrl= function(file){
	var uri = Url.parse(file)
	if (uri.protocol) {
		if (uri.protocol != "http:" && uri.protocol != "https:" && uri.protocol != "file:") {
			throw new Error("Protocol " + uri.protocol + " not supported")
		}
	}
	return uri 
}

/** resolve a file in current module, and require */
exports.import= Mod.import= function(file, options){

	var uri2 , promise, original, filename
	original= file



	if(builtinModules.indexOf(file) >= 0){
		return require(file)
	}


	var uri = validateFileUrl(file)
	if(uri.protocol || Path.isAbsolute(file)){
		return Mod.require(file,options)
	}
	else{

		// create a path from parent 
		if(!this.filename){
			throw new Error("Cannot resolve file or URL: " + file)
		}
		
		
		
		if (file.startsWith("./") || file.startsWith("../")) {
			uri2 = Url.parse(this.filename)
			if (uri2.protocol) {
				if(file.startsWith("./"))
					file= file.substring(2)

				file = Url.resolve(this.filename, file)
				return Mod.require(file, options)
			}
			else{

				// find this or with extensions
				file= Path.join(Path.dirname(this.filename), file)
				filename= this.filename 
				promise= new Promise(function(resolve,reject){					
					var ids= Object.keys(Mod.extensions)
					var i= -1
					var f= function(file, ext){
						var cfile= file
						if(ext){
							cfile= file + ext
						}

						fs.access(cfile, fs.constants.F_OK, function(err){
							if(err){
								// test next
								i++ 
								ext= ids[i]
								if(!ext)
									return reject(new Error("Cannot resolve " + original + " from " + filename))
								
								return f(file, ext)									
							}
							return resolve(Mod.require(cfile, options))
						})
					}
					f(file)
				})
				return promise
			}
			

		}
		else {
			file= require.resolve(file)
			return Mod.require(file, options)
		}

	}

}

/** Allow create more extensions */
Mod.extensions= {
	".json": null,
	".js": null, 
	".es6": null
}



/** Allow importing modules in KModule way by default, with import keyword */
exports.injectImport= Mod.injectImport= function(){
	Mod.__injected= true 
}



Mod.__num= 0
var changeSource= function(source){
	var reg = /import\s+.+\s+from\s+(\"|\')(.+)(\"|\')(\;|\r|\n)/g	
	var num= Mod.__num++

	var mod, op
	var unq = "___kawi__internal__" + Date.now().toString(28) + num 
	var cid= -1
	var imports= {
		unq:unq,
		mods:[]
	}

	source= source.replace(reg, function (a, b, c, d) {
		var name = eval(b + c + d)
		if(builtinModules.indexOf(name) >= 0)
			return a 
		

		imports.mods.push(name)
		cid++
		return a.replace(b+c+d, "'"+ unq + "." + cid + ".js'")
	})

	if(imports.mods){
		var morecode= ['var ___kawi__async= async function(KModule){']
		for(var i=0;i<imports.mods.length;i++){
			mod= imports.mods[i]
			op= {
				uid: unq + "." + i + ".js"
			}
			morecode.push("\tawait KModule.import("+JSON.stringify(mod)+", "+ JSON.stringify(op) +")")
		}
		morecode.push("}")
		imports.inject= morecode.join("\n")
		imports.source= source + "\n" + imports.inject 
	}
	return imports 
}


var asynchelper = "function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }\n\nfunction _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, \"next\", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, \"throw\", err); } _next(undefined); }); }; }"
var loadInjectImportFunc= function(ast){

	
	var code, injectCode, ucode
	if(!ast.injectCode){
		var i= ast.code.indexOf("var ___kawi__async =")
		if(i >= 0){
			code= ast.code.substring(0,i)
			injectCode= ast.code.substring(i+20)
			ast.code = code 
			ast.injectCode= injectCode 
		}
	}

	if(ast.injectCode && !ast.inject){
		ucode= "(function(){" + asynchelper + "\n\nreturn" + ast.injectCode + "\n})()"
		ast.inject= eval(ucode)
	}

}




/** Remove a module from cache */
exports.removeCached= Mod.removeCached= function(file){
	var cached = Mod._cacherequire[file]
	if(cached){
		if (cached.__kawi_uid && cached.__kawi_uid.length){
			for (var i = 0; i < cached.__kawi_uid.length;i++){
				delete Module._cache[cached.__kawi_uid[i]]
			}
		}
		delete Module._cache[file]
		delete Mod._cacherequire[file]
	}
}



/** require a module (file or url) */
exports.require= Mod.require= function(file, options){
	options=options || {}
	var cached = Mod._cacherequire[file]
	if(cached){
		Module._cache[file] = cached
		if (options.uid)
			cached.__kawi_uid[options.uid] = true

		Module._cache[options.uid || "_internal_kawi_last.js"] = cached
		return cached.exports
	}


	var promise= Mod.compile(file,options)
	var promise2= new Promise(function(resolve, reject){
		promise.then(function(ast){

			var module = new Module(file)
			module.exports = {}

			var nmod = {}
			nmod.require = Mod.require
			nmod.import = Mod.import
			nmod.extensions = Mod.extensions
			nmod.removeCached = Mod.removeCached
			nmod.filename = file 
			module.KModule = nmod 


			var continue1= function(){
				module._compile("exports.__kawi= function(KModule){"+ ast.code  + "}", file)

				// custom mod for each file 
				
				
				Module._cache[file] = module
				Mod._cacherequire[file] = module
				module.__kawi_uid= {}
				if(options.uid)
					module.__kawi_uid[options.uid]= true

				var maybePromise= module.exports.__kawi(nmod)
				/*
				if(maybePromise && maybePromise.then){
					maybePromise.then(function(){
						Module._cache[options.uid || "_internal_kawi_last.js"] = module
						return resolve(module.exports)
					}).catch(reject)
				}else{*/
				Module._cache[options.uid || "_internal_kawi_last.js"] = module
				return resolve(module.exports)
				//}
			}
			if(ast.injectCode && !ast.inject){
				// inject the code 
				loadInjectImportFunc(ast)
			}
			
			if(ast.inject){

				ast.inject(nmod).then(function () {
					continue1()
				}).catch(reject)

			}else{
				continue1()
			}
		}).catch(reject)
	})

	return promise2

}


var readHttp= function(url){
	var xhttp= url.startsWith("http://") ? "http" : "https"
	var http= httpr[xhttp]
	if (!http)
		http = httpr[xhttp]= require(xhttp)
	
	var promise= new Promise(function(resolve, reject){
		var callback= function(resp){
			
			var buf = [], code
			if(resp.statusCode == 302){
				var loc= resp.headers.location
				if(!loc.startsWith("http:") && !loc.startsWith("https:")){
					loc= Url.resolve(url, loc)	
				}
				return resolve(readHttp(loc))				
			}
			else if(resp.statusCode != 200){
				return reject(new Error("Invalid response from "  + url))
			}
			else{
				
				resp.on("data",function(b){
					if(!Buffer.isBuffer(b))
						b= Buffer.from(b)
					buf.push(b)
				})
				resp.on("error", reject)
				resp.on("end", function(){
					buf= Buffer.concat(buf)
					code= buf.toString('utf8')
					
					return resolve({
						code: code,
						"type": resp.headers["content-type"]
					})
				})
			}
		}
		
		http.get(url, callback).on("error", reject)
	})
	return promise
}



/** Transpile moden es2017 code to old javascript */
exports.compile= Mod.compile= function(file, options){

	var source= ''
	options= options || {}
	source= options.source
	if(options.injectImport === undefined){
		options.injectImport= Mod.__injected
	}

	var uri= validateFileUrl(file)
	if(uri.protocol == "file:"){
		file= Url.fileURLToPath(file)
	}
	

	var name= file.replace(/\/|\\|\:/g, "$")


	if (options.injectImport){
		name += "$__injected"
	}


	var cached= Path.join(Os.homedir(), ".kawi")
	var cached1 = Path.join(cached, "compile")
	var cached2 = Path.join(cached1, name)
	var fromHttp 
	if (file.startsWith("http://") || file.startsWith("https://")) {
		
		fromHttp= true 
	}

	var json, stat, statc, str, ucached, isjson

	var promise= new Promise(function(resolv, reject){


		var resolve= function(value){
			value.time= Date.now() 
			Mod._cache[file]= value 
			return resolv(value)
		}
		var action= ''
		var f 
		var ug = function (err, value) {
			
			if(!action){
				action= 'cached'
				return fs.access(cached, fs.constants.F_OK, f)
			}
			else if(action == "cached"){
				action = "cached1"
				if (err) {					
					fs.mkdir(cached, f)
				}
				return f()
			}
			else if(action== "cached1"){
				action = "cached2"
				return fs.access(cached1, fs.constants.F_OK, f)
			}
			else if (action == "cached2") {
				action = "cached3"
				if (err) {
					fs.mkdir(cached1, f)
				}
				return f()
			}
			else if(action == "cached3"){
				action = "cached4"
				return fs.access(cached2, fs.constants.F_OK, f)
			}
			else if(action == "cached4"){
				if(!err){
					action= "stat"
				}
				else{
					action= "compile"
				}
			}
			
			else if(action == "stat"){
				if(err)
					return reject(err)
				

				ucached= Mod._cache[file]
				if(ucached &&  (Date.now() - ucached.time <= Mod.cachetime)){
					return resolv(ucached)
				}

				action= 'stat2'				
				return fs.stat(cached2, f)
			}
			else if (action == "stat2") {
				if (err)
					return reject(err)
				
				action = 'compare'
				statc = value
				if(fromHttp && !options.force){
					return f(null, statc)
				}
				else if(fromHttp && options.force){
					return f(null, {
						mtime: new Date()
					})
				}
				return fs.stat(file, f)
			}
			else if (action == "compare") {
				if (err)
					if(!source)
						return reject(err)
					else 
						stat= {mtime:new Date(options.mtime)}

				stat = value
				if(stat.mtime.getTime() > statc.mtime.getTime()){
					action= "compile"
					return f()
				}
				else{

					
					// good, return the cached
					action= "json"
					return fs.readFile(cached2, 'utf8', f)

				}
			}
			else if (action == "json") {
				if (err) {
					return reject(err)
				}

				json= JSON.parse(value)
				return resolve(json)
			}
			else if(action == "compile"){
				if (err) {
					return reject(err)
				}

				action= "transpile"
				if(source){
					return f(null, source)
				}else{
					
					if(fromHttp){
						if (!process.env.DISABLE_COMPILATION_INFO) {
							console.info("Downloading: " + file + " ...")
						}
						
						return readHttp(file).then(function (value) {
							return f(null, value)
						}).catch(reject)
					}
					return fs.readFile(file, 'utf8', f)

				}
			}
			else if (action == "transpile") {
				if (err) {
					return reject(err)
				}
				if(!process.env.DISABLE_COMPILATION_INFO){
					console.info("Compiling file: " + file)
				}

				if(value.type){
					
					isjson= value.type.startsWith("application/json")
					value= value.code 
				}
				else{
					isjson= file.endsWith(".json")
				}

				if(isjson){
					json={
						code: "module.exports= " + value
					}
				}
				else{
					if (options.injectImport){
						imports= changeSource(value)
						
						value= imports.source 
					}
					json= Next.transpile(value)
					delete json.options
					if(options.injectImport){					
						loadInjectImportFunc(json)
					}
				}

				str= JSON.stringify(json)
				action= "writecache"
				fs.writeFile(cached2, str, f)

			}
			else if (action == "writecache") {
				if(err){
					return reject(err)
				}
				// good return result 
				return resolve(json)
			}
			return f()
		}
		f= function(err, data){
			try{
				ug(err,data)
			}catch(e){
				
				return reject(e)
			}
		}
		f()
	})
	return promise 
}




