define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/array',

	'dijit/_WidgetBase',
	'dijit/_TemplatedMixin',
	'dijit/_WidgetsInTemplateMixin',

	'dojo/text!./ISSTracker/templates/ISSTracker.html',
	'xstyle/css!./ISSTracker/css/ISSTracker.css',

	'dojo/json',
	'dojo/on',
	'dojo/topic',

	'esri/request',

	'esri/geometry/webMercatorUtils',
	'esri/geometry/Point',
	'esri/geometry/Circle',

	'esri/graphic',
	'esri/InfoTemplate',
	'esri/layers/GraphicsLayer',
	'esri/layers/FeatureLayer',

	'esri/renderers/SimpleRenderer',
	'esri/symbols/PictureMarkerSymbol',
	'esri/symbols/SimpleMarkerSymbol',

	'put-selector',
], function(
	declare, lang, array,
	_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin,
	template, css,
	JSON, on, topic,
	esriRequest,
	webMercatorUtils, Point, Circle,
	Graphic, InfoTemplate, GraphicsLayer, FeatureLayer,
	SimpleRenderer, PictureMarkerSymbol, SimpleMarkerSymbol,
	put
) {
	return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
		templateString: template,
		baseClass: 'issTracker',
		issWakeLength: 10,
		issWakeCounter: 0,
		postCreate: function() {
			this.inherited(arguments);
			this._initListeners();
			this.wakeObject = this._initWake(this.issWakeLength);
			this.wakeObjectEmpty = lang.clone(this.wakeObject);
			this._initMapLayers();
		},
		_initListeners: function() {
			// both the locateButton and geocoder widgets can request the next ISS overhead pass time
			// but, they are published and handled slightly differently
			this.own(topic.subscribe('locateButton/graphic', lang.hitch(this, '_getISSPassTime')));
			this.own(topic.subscribe('geocoder/feature', lang.hitch(this, '_getISSPassTime')));
		},
		_initWake: function(wakeLength) {
			var counter = 0,
				wakeObject = {};
			while (counter < wakeLength) {
				wakeObject[counter] = [];
				counter += 1;
			}
			return wakeObject;
		},
		_initMapLayers: function() {
			this.issLocationLayer = this._createISSLayer();
			this.astroPhotosLayer = this._createAstronautPhotographyLayer();

			// automatically find it
			this.own(on.once(this.map, 'layer-add-result', lang.hitch(this, function(evt) {
				if (evt.layer.id === 'issLocation') {
					this._findISS(true);
				}
			})));

			this.map.addLayers([this.issLocationLayer, this.astroPhotosLayer]);
		},
		_createISSLayer: function() {
			var issLocationLayer = new GraphicsLayer({
				id: 'issLocation'
			});
			var symbol = new PictureMarkerSymbol(this.config.symbolDefinitions.iss);
			issLocationLayer.setRenderer(new SimpleRenderer(symbol));
			return issLocationLayer;
		},
		_createAstronautPhotographyLayer: function() {
			var content = put('div');
			var a = put(content, 'a', {
				href: 'http://eol.jsc.nasa.gov/scripts/sseop/photo.pl?mission=${mission}&roll=${roll}&frame=${frame}',
				target: '_blank',
				innerHTML: '<div><i class="icon-camera" style="font-size:20px;margin:0 10px 10px 0;"></i>View ${missionRollFrame}</div>'
			});
			put(a, 'img', {
				width: '250',
				// width: '345',
				src: 'http://eol.jsc.nasa.gov/sseop/images/ESC/small/${mission}/${missionRollFrame}.JPG',
			});
			var photoCredits = put(content, 'div', {
				innerHTML: 'Earth Science and Remote Sensing Unit, NASA-Johnson Space Center. "The Gateway to Astronaut Photography of Earth."'
			});
			put(photoCredits, '.photoCredits');

			var infoTemplate = new InfoTemplate();
			infoTemplate.setTitle('${missionRollFrame}');
			infoTemplate.setContent(content.innerHTML);

			var layerConfig = this.config.layerResources.astroPhotos;
			var astroPhotosLayer = new FeatureLayer(layerConfig.url, {
				id: layerConfig.id,
				outFields: layerConfig.outFields,
				infoTemplate: infoTemplate,
				mode: FeatureLayer.MODE_ONDEMAND
			});

			var symbol = new SimpleMarkerSymbol(this.config.symbolDefinitions.astroPhoto);
			astroPhotosLayer.setRenderer(new SimpleRenderer(symbol));
			astroPhotosLayer.setDefinitionExpression('OBJECTID < 0');
			return astroPhotosLayer;
		},


		_trackISS: function(evt) {
			if (evt.target.checked) {
				this._startTrackingISS();
				put(this.trackToggleButton, '!success.error');
				put(this.trackToggleIcon, '!icon-play.icon-pause');
			} else {
				this._stopTrackingISS();
				put(this.trackToggleButton, '!error.success');
				put(this.trackToggleIcon, '!icon-pause.icon-play');
			}
		},
		_startTrackingISS: function() {
			// reset the wake object
			this.wakeObject = lang.clone(this.wakeObjectEmpty);
			this._findISS(true); // set zoom level on first time
			this.intervalID = setInterval(lang.hitch(this, '_findISS', false), 5000);
		},
		_stopTrackingISS: function() {
			clearInterval(this.intervalID);
		},
		_findISS: function(centerAndZoom) {
			var issNowReturnObj;
			esriRequest({
				url: 'http://api.open-notify.org/iss-now.json',
				content: {
					f: 'json',
					callback: issNowReturnObj
				}
			}).then(lang.hitch(this, '_findISSSuccess', centerAndZoom), lang.hitch(this, '_findISSErr'));
		},
		_findISSSuccess: function(centerAndZoom, res) {
			if (res.message === 'success') {
				// lngLat for d3 geojson
				// xyWebMercator for esri jsapi
				var lngLat = [res.iss_position.longitude, res.iss_position.latitude];
				var xyWebMercator = webMercatorUtils.lngLatToXY(res.iss_position.longitude, res.iss_position.latitude);

				var issPt = new Point(xyWebMercator, this.map.spatialReference);
				if (!this.issPtGraphic) {
					this.issPtGraphic = new Graphic(issPt);
					this.issLocationLayer.add(this.issPtGraphic);
				} else {
					this.issPtGraphic.setGeometry(issPt);
				}

				if (centerAndZoom) {
					this.map.centerAndZoom(issPt, 5);
				}

				this._updateGlobe(lngLat);

				this._findNearbyPhotos(issPt);
			}
		},
		_findISSErr: function(err) {
			console.log(err);
		},


		_updateGlobe: function(lngLat) {
			// send X,Y to D3 and show it on the globe
			topic.publish('iss/location', lngLat);
		},


		_findNearbyPhotos: function(mapPoint) {
			var circleGeom = new Circle(mapPoint, {
				geodesic: true,
				radius: 50000, // meters
				numberOfPoints: 120
			});

			var circleGeomJson = circleGeom.toJson();
			esriRequest({
				url: this.astroPhotosLayer.url + '/query',
				content: {
					f: 'json',
					returnIdsOnly: true,
					geometryType: 'esriGeometryPolygon',
					geometry: JSON.stringify(circleGeomJson),
					outSR: 102100,
					where: '1=1'
				},
				handleAs: 'json',
				callbackParamName: 'callback'
			}).then(lang.hitch(this, '_findNearbyPhotosComplete'), lang.hitch(this, '_findNearbyPhotosErr'));
		},
		_findNearbyPhotosComplete: function(res) {
			if (this.issWakeCounter === this.issWakeLength) {
				this.issWakeCounter = 0;
			}
			this.wakeObject[this.issWakeCounter] = (res.objectIds === null) ? [-1] : res.objectIds;
			var whereClauseIds = [];
			for (var i in this.wakeObject) {
				if (this.wakeObject.hasOwnProperty(i)) {
					whereClauseIds = whereClauseIds.concat(this.wakeObject[i]);
				}
			}
			if (whereClauseIds.length > 0) {
				this.astroPhotosLayer.setDefinitionExpression('OBJECTID IN (' + whereClauseIds.join(',') + ')');
			} else {
				this.astroPhotosLayer.setDefinitionExpression('OBJECTID < 0');
			}
			this.issWakeCounter += 1;
		},
		_findNearbyPhotosErr: function(err) {
			console.log(err);
		},


		_getISSPassTime: function(graphic, target) {
			// target: 'locateButton' || 'geocoder'
			var lngLatGeom = webMercatorUtils.webMercatorToGeographic(graphic.geometry);
			var issPassTimeReturnObj;
			esriRequest({
				url: 'http://api.open-notify.org/iss-pass.json',
				content: {
					f: 'json',
					lat: lngLatGeom.y,
					lon: lngLatGeom.x,
					callback: issPassTimeReturnObj
				}
			}).then(lang.hitch(this, '_getISSPassTimeSuccess', target), lang.hitch(this, '_getISSPassTimeErr'));
		},

		_getISSPassTimeSuccess: function(target, res) {
			if (res.message === 'success') {
				topic.publish('iss/passTimes', res, target);
			}
		},
		_getISSPassTimeErr: function(err) {
			console.log(err);
		}
	});
});